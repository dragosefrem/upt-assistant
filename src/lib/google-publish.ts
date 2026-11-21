import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { googleEventLinks, googleExceptions } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import type { User } from "./auth";
import type { CalendarFields, CalendarTime, CalendarTiming, GoogleEvent } from "./calendar-types";
import { calendarSlices, campusDate, instant, occurrenceKey } from "./calendar-timing";
import { GoogleError } from "./google-api";
import { equalField, fieldNames, googleBody, remoteFields } from "./google-event";
import { forgetLink, linkKey, snapshot, sourceFields } from "./google-reconcile";
import { addDays, daysBetween } from "./time";

type Api = <T>(method: string, path: string, body?: unknown, etag?: string) => Promise<T>;
const freshId = () => randomUUID().replaceAll("-", "");
const gone = (e: unknown) => e instanceof GoogleError && (e.status === 404 || e.status === 410);

function occurrenceTiming(master: CalendarTiming, original: CalendarTime): CalendarTiming | null {
  const day = campusDate(original);
  if (!calendarSlices(master, day, day).some(s => s.occurrence === occurrenceKey(original))) return null;
  if (original.date && master.start.date && master.end.date) {
    return { start: original, end: { date: addDays(original.date, daysBetween(master.start.date, master.end.date)) } };
  }
  const duration = instant(master.end).toMillis() - instant(master.start).toMillis();
  const end = instant(original).plus({ milliseconds: duration });
  return { start: original, end: { dateTime: end.toISO()!, timeZone: master.end.timeZone },
    ...(master.endTimeUnspecified ? { endTimeUnspecified: true } : {}) };
}

/** Publish the current Poli schedule. Google-origin pairs are paused with their two-way baseline intact. */
export async function publishCalendar(user: User, locale: Locale, inventory: GoogleEvent[], path: string, api: Api) {
  const db = getDb();
  const id = user.id;
  const local = sourceFields(user, locale);
  const all = db.select().from(googleEventLinks).where(eq(googleEventLinks.userId, id)).all();
  const links = new Map(all.map(l => [l.uid, l]));
  const byId = new Map(all.map(l => [l.googleId, l]));
  const remote = new Map(inventory.map(e => [e.id, e]));
  const url = (eventId: string) => path + "/" + encodeURIComponent(eventId);
  let writes = 0;

  // Adopt resources left by the original one-way exporter using its private UID.
  for (const event of inventory) {
    const uid = event.extendedProperties?.private?.uptOrar;
    if (!uid || event.recurringEventId || event.status === "cancelled" || byId.has(event.id) || links.has(uid)) continue;
    if (!/^(personal-\d+|exam-\d+|entry-\d+(?:-\d{4}-\d{2}-\d{2})?|group-[\w-]+)$/.test(uid)) continue;
    const link = db.insert(googleEventLinks).values({ userId: id, uid, googleId: event.id,
      base: local.get(uid) ?? remoteFields(event), origin: "poli" }).returning().get();
    links.set(uid, link);
  }
  for (const [uid, fields] of local) {
    if (links.has(uid)) continue;
    links.set(uid, db.insert(googleEventLinks).values({ userId: id, uid, base: fields, origin: "poli", googleId: freshId() }).returning().get());
  }

  const active = new Map<string, CalendarFields>();
  const remove = async (event: GoogleEvent) => {
    try { await api("DELETE", url(event.id), undefined, event.etag ?? "*"); writes++; }
    catch (e) { if (!gone(e)) throw e; }
  };
  for (const [uid, link] of links) {
    let current = remote.get(link.googleId);
    const where = linkKey(id, uid);
    // Earlier versions did not record origin. Live resources still carry the Poli tag.
    const origin = link.origin ?? (current?.extendedProperties?.private?.uptOrar === uid || !uid.startsWith("personal-") || !link.remote ? "poli" : "google");
    if (!link.origin) db.update(googleEventLinks).set({ origin }).where(where).run();
    if (origin === "google") continue;
    if (!link.remote && current && current.status !== "cancelled" && current.extendedProperties?.private?.uptOrar !== uid) {
      // A reserved ID can collide with an existing Google item. Leave that item in place.
      link.googleId = freshId();
      db.update(googleEventLinks).set({ googleId: link.googleId }).where(where).run();
      current = undefined;
    }

    const raw = local.get(uid);
    const hiddenInPoli = link.remote?.status === "cancelled" && !uid.startsWith("personal-");
    if (!raw || hiddenInPoli) {
      if (current && current.status !== "cancelled") await remove(current);
      if (!raw && !uid.startsWith("personal-")) db.transaction(() => forgetLink(id, link));
      else if (link.remote?.status !== "cancelled") {
        db.update(googleEventLinks).set({ remote: { id: link.googleId, status: "cancelled" }, pending: null }).where(where).run();
      }
      continue;
    }

    // Retain personalizations accepted before the student chose one-way, until edited in Poli.
    const overrides = { ...link.overrides };
    for (const key of fieldNames) if (!equalField(key, raw, link.base)) delete overrides[key];
    const desired = { ...raw, ...overrides };
    if (current && current.status !== "cancelled" && current.etag === link.remote?.etag && !link.pending
        && fieldNames.every(key => equalField(key, raw, link.base))) {
      active.set(link.googleId, desired);
      continue;
    }
    let googleId = link.googleId;
    let acknowledged = current;
    if (!current || current.status === "cancelled") {
      if (link.remote || current) {
        googleId = freshId();
        db.transaction(tx => {
          tx.update(googleEventLinks).set({ googleId, remote: null, pending: desired }).where(where).run();
          tx.update(googleExceptions).set({ parentId: googleId }).where(and(eq(googleExceptions.userId, id), eq(googleExceptions.parentId, link.googleId))).run();
        });
      }
      acknowledged = await api<GoogleEvent>("POST", path, { id: googleId, ...googleBody(desired), extendedProperties: { private: { uptOrar: uid } } });
      writes++;
    } else {
      const observed = remoteFields(current);
      const prior = link.remote && link.remote.status !== "cancelled" ? remoteFields(link.remote) : null;
      const patch: Partial<CalendarFields> = {};
      for (const key of fieldNames) {
        if (equalField(key, desired, observed)) continue;
        // Google can normalize a value it accepted, such as a timezone or recurrence line.
        if (prior && equalField(key, raw, link.base) && equalField(key, observed, prior) && !(link.pending && key in link.pending)) continue;
        Object.assign(patch, { [key]: desired[key] });
      }
      if (Object.keys(patch).length) {
        acknowledged = await api<GoogleEvent>("PATCH", url(googleId), googleBody(patch, true), current.etag);
        writes++;
      }
    }
    if (!acknowledged) throw new Error("Google Calendar did not acknowledge the published event.");
    db.update(googleEventLinks).set({ base: raw, remote: snapshot(acknowledged), overrides, pending: null }).where(where).run();
    active.set(googleId, desired);
  }

  // A Google edit to one occurrence must not move the class inside Poli. Restore the
  // previously agreed exception, or the scheduled master occurrence, on Google's side.
  const saved = db.select().from(googleExceptions).where(eq(googleExceptions.userId, id)).all();
  const priorInstances = new Map(saved.map(r => [r.googleId, r.event]));
  const instances = inventory.filter(e => e.recurringEventId && active.has(e.recurringEventId));
  for (const row of saved) {
    if (!active.has(row.parentId) || row.parentId === row.event.recurringEventId || !row.event.originalStartTime) continue;
    // A deleted series received a new ID. Locate its replacement instance by original start.
    const query = new URLSearchParams({ originalStart: instant(row.event.originalStartTime).toUTC().toISO()!, showDeleted: "true" });
    const page = await api<{ items?: GoogleEvent[] }>("GET", url(row.parentId) + "/instances?" + query);
    const replacement = page.items?.find(e => e.originalStartTime && occurrenceKey(e.originalStartTime) === occurrenceKey(row.event.originalStartTime!));
    if (!replacement) continue;
    const expected = { ...row.event, id: replacement.id, recurringEventId: row.parentId };
    priorInstances.set(replacement.id, expected);
    if (!instances.some(e => e.id === replacement.id)) instances.push(replacement);
    // Keep the old identity until the repair succeeds, so an interrupted run finds it again.
  }
  for (const event of instances) {
    const master = active.get(event.recurringEventId!)!;
    if (!event.originalStartTime) continue;
    const prior = priorInstances.get(event.id);
    const timing = prior ? prior.start && prior.end ? remoteFields(prior).timing : null : occurrenceTiming(master.timing, event.originalStartTime);
    if (!timing || prior?.status === "cancelled") {
      if (event.status !== "cancelled") await remove(event);
    } else {
      const expected = prior ? remoteFields(prior) : { ...master, timing };
      const observed = event.status !== "cancelled" ? remoteFields(event) : null;
      const patch: Partial<CalendarFields> = {};
      for (const key of fieldNames) if (!observed || !equalField(key, expected, observed)) Object.assign(patch, { [key]: expected[key] });
      if (Object.keys(patch).length) {
        // Instance resources have no recurrence rules of their own.
        const body = googleBody(patch, true);
        delete body.recurrence;
        try { await api("PATCH", url(event.id), { ...body, status: "confirmed" }, event.etag ?? "*"); writes++; }
        catch (e) {
          if (!gone(e)) throw e;
          const parent = remote.get(event.recurringEventId!);
          if (parent) await remove(parent);
          throw new GoogleError("The recurring event needs a new Google resource.", 412);
        }
      }
    }
    const old = saved.find(row => row.parentId === event.recurringEventId && row.event.recurringEventId !== row.parentId
      && row.event.originalStartTime && occurrenceKey(row.event.originalStartTime) === occurrenceKey(event.originalStartTime!));
    if (old && prior) db.update(googleExceptions).set({ googleId: event.id, event: prior })
      .where(and(eq(googleExceptions.userId, id), eq(googleExceptions.googleId, old.googleId))).run();
  }
  return writes;
}
