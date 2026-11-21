import "server-only";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { googleEventLinks, googleExceptions, personalEvents } from "@/db/schema";
import type { CalendarFields, GoogleEvent } from "./calendar-types";
import { personalTimes } from "./calendar-timing";
import type { Locale } from "@/i18n/config";
import type { User } from "./auth";
import { sourceItems } from "./export";
import { equalField, fieldNames, localFields, remoteFields } from "./google-event";

export type Link = typeof googleEventLinks.$inferSelect;
export const linkKey = (userId: string, uid: string) => and(eq(googleEventLinks.userId, userId), eq(googleEventLinks.uid, uid));
const personalKey = (userId: string, id: number) => and(eq(personalEvents.userId, userId), eq(personalEvents.id, id));
const personalId = (uid: string) => /^personal-(\d+)$/.test(uid) ? Number(uid.slice(9)) : undefined;

export function sourceFields(user: User, locale: Locale, links: Link[]) {
  const fields = new Map(sourceItems(user, locale).map(item => [item.uid, localFields(item)]));
  for (const link of links) {
    const local = fields.get(link.uid);
    // Changing Poli's export default must preserve reminders the student manages in Google.
    if (local && (link.origin === "google" || link.overrides?.reminders)) {
      local.reminders = link.base.reminders;
    }
  }
  return fields;
}

function personalPatch(fields: Partial<CalendarFields>) {
  return {
    ...(fields.summary !== undefined ? { title: fields.summary } : {}),
    ...(fields.location !== undefined ? { location: fields.location || null } : {}),
    ...(fields.description !== undefined ? { description: fields.description || null } : {}),
    ...(fields.timing ? { ...personalTimes(fields.timing), calendarTiming: fields.timing } : {}),
  };
}

export function forgetLink(userId: string, link: Link) {
  const db = getDb();
  db.delete(googleExceptions).where(and(eq(googleExceptions.userId, userId), eq(googleExceptions.parentId, link.googleId))).run();
  db.delete(googleEventLinks).where(linkKey(userId, link.uid)).run();
}

/** Only retain event fields needed by Poli. Invitations, attachments and conference details stay at Google. */
export function snapshot(e: GoogleEvent): GoogleEvent {
  if (!e.id || (e.status !== "cancelled" && !e.etag)) throw new Error("Google Calendar returned an incomplete event.");
  const { id, etag, status, summary, location, description, start, end, recurrence, endTimeUnspecified, reminders, recurringEventId, originalStartTime } = e;
  return { id, etag, status, summary, location, description, start, end, recurrence, endTimeUnspecified, reminders, recurringEventId, originalStartTime };
}

/** A whole Google's page set is applied synchronously in the caller's SQLite transaction. */
export function acceptChanges(user: User, locale: Locale, events: GoogleEvent[], full: boolean) {
  const db = getDb();
  const links = db.select().from(googleEventLinks).where(eq(googleEventLinks.userId, user.id)).all();
  const sources = sourceFields(user, locale, links);
  const byId = new Map(links.map(link => [link.googleId, link]));
  const byUid = new Map(links.map(link => [link.uid, link]));
  const received = new Set(events.map(e => e.id));
  // An expired cursor needs a fresh listing. A missing previously acknowledged resource is a deletion.
  const resources = full ? [...events, ...links.filter(l => l.remote && l.remote.status !== "cancelled" && !received.has(l.googleId))
    .map(l => ({ id: l.googleId, status: "cancelled" } as GoogleEvent))] : events;
  const exceptions = db.select().from(googleExceptions).where(eq(googleExceptions.userId, user.id)).all();
  const existingExceptions = new Map(exceptions.map(e => [e.googleId, e]));
  for (const event of resources) {
    const previousException = existingExceptions.get(event.id);
    const parentId = event.recurringEventId ?? previousException?.parentId;
    if (parentId) {
      const saved = snapshot({ ...event, recurringEventId: parentId, originalStartTime: event.originalStartTime ?? previousException?.event.originalStartTime });
      if (!saved.originalStartTime) continue;
      db.insert(googleExceptions).values({ userId: user.id, googleId: event.id, parentId, event: saved })
        .onConflictDoUpdate({ target: [googleExceptions.userId, googleExceptions.googleId], set: { parentId, event: saved } }).run();
      continue;
    }
    let link = byId.get(event.id);
    if (link && !link.origin && event.status !== "cancelled") {
      const origin = event.extendedProperties?.private?.uptOrar === link.uid ? "poli" : "google";
      db.update(googleEventLinks).set({ origin }).where(linkKey(user.id, link.uid)).run();
    }
    if (link?.remote?.etag && event.etag === link.remote.etag && event.status === link.remote.status) continue;
    if (event.status === "cancelled") {
      if (!link) continue;
      const id = personalId(link.uid);
      if (id !== undefined) db.delete(personalEvents).where(personalKey(user.id, id)).run();
      db.update(googleEventLinks).set({ remote: snapshot(event), pending: null }).where(linkKey(user.id, link.uid)).run();
      continue;
    }
    const fields = remoteFields(event);
    if (!link) {
      const tagged = event.extendedProperties?.private?.uptOrar;
      if (tagged && !byUid.has(tagged) && !sources.has(tagged)) continue;
      let uid: string;
      let base: CalendarFields;
      let origin: "poli" | "google";
      if (tagged && sources.has(tagged) && !byUid.has(tagged)) {
        origin = "poli";
        uid = tagged;
        base = sources.get(uid)!;
      } else {
        origin = "google";
        const row = db.insert(personalEvents).values({
          userId: user.id, title: fields.summary, ...personalTimes(fields.timing), ...personalPatch(fields),
        }).returning({ id: personalEvents.id }).get();
        uid = "personal-" + row.id;
        base = { ...fields, reminders: { useDefault: true } };
        sources.set(uid, base);
      }
      link = db.insert(googleEventLinks).values({ userId: user.id, uid, googleId: event.id, base, origin }).returning().get();
      byUid.set(uid, link);
      byId.set(event.id, link);
    }
    if (!sources.has(link.uid) && link.remote?.status === "cancelled" && personalId(link.uid) !== undefined) {
      const restored = db.insert(personalEvents).values({
        userId: user.id, title: fields.summary, ...personalTimes(fields.timing), ...personalPatch(fields),
      }).returning().get();
      const uid = "personal-" + restored.id;
      const base = { ...fields, reminders: { useDefault: true } };
      link = db.update(googleEventLinks).set({ uid, base, remote: null, overrides: null }).where(linkKey(user.id, link.uid)).returning().get();
      sources.set(uid, base);
    }
    const current = sources.get(link.uid);
    // If the local personal record has already been removed, the subsequent upload deletes its remote copy.
    if (!current) {
      db.update(googleEventLinks).set({ remote: snapshot(event) }).where(linkKey(user.id, link.uid)).run();
      continue;
    }
    const prior = link.remote && link.remote.status !== "cancelled" ? remoteFields(link.remote) : link.base;
    const base = { ...link.base };
    const overrides = link.remote?.status === "cancelled" ? {} as Partial<CalendarFields> : { ...link.overrides };
    const changes: Partial<CalendarFields> = {};
    const id = personalId(link.uid);
    for (const key of fieldNames) {
      if (link.pending && key in link.pending && equalField(key, link.pending, fields)) {
        // Google accepted an earlier write whose response was lost. Preserve any newer local edit.
        Object.assign(base, { [key]: link.pending[key] });
        delete overrides[key];
        continue;
      }
      if (equalField(key, prior, fields)) continue;
      // If both sides edited the same field since the last sync, accept the Google edit.
      // Distinct local edits keep their old baseline and are uploaded independently.
      if (id !== undefined && key !== "reminders") {
        Object.assign(changes, { [key]: fields[key] });
        Object.assign(base, { [key]: fields[key] });
      } else {
        Object.assign(base, { [key]: current[key] });
        if (equalField(key, fields, current)) delete overrides[key];
        else Object.assign(overrides, { [key]: fields[key] });
      }
    }
    if (id !== undefined && Object.keys(changes).length) db.update(personalEvents).set(personalPatch(changes)).where(personalKey(user.id, id)).run();
    db.update(googleEventLinks).set({ base, overrides, pending: null, remote: snapshot(event) }).where(linkKey(user.id, link.uid)).run();
  }
  if (full) {
    for (const ex of exceptions) {
      if (!received.has(ex.googleId)) db.delete(googleExceptions).where(and(eq(googleExceptions.userId, user.id), eq(googleExceptions.googleId, ex.googleId))).run();
    }
  }
}
