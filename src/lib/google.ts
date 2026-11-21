import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { googleEventLinks, googleExceptions, googleSyncState, users } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { settings } from "@/i18n/messages/settings";
import type { User } from "./auth";
import type { CalendarFields, GoogleEvent } from "./calendar-types";
import { call, GoogleError, token } from "./google-api";
import { equalField, fieldNames, googleBody } from "./google-event";
import { acceptChanges, forgetLink, linkKey, snapshot, sourceFields } from "./google-reconcile";
import { TIME_ZONE } from "./time";

export { appUrl, consentUrl, exchangeCode, googleConfigured, GoogleError } from "./google-api";
const INTERVAL = 60_000;
const LEASE = 90_000;
type Result = { events: number; calendarId: string };
type EventPage = { items?: GoogleEvent[]; nextPageToken?: string; nextSyncToken?: string };
const absent = (e: unknown) => e instanceof GoogleError && (e.status === 404 || e.status === 410);

async function syncAccount(id: string, requestLocale?: Locale): Promise<Result> {
  const db = getDb();
  const account = () => db.select().from(users).where(eq(users.id, id)).get();
  const user = account();
  const locale = user?.locale ?? requestLocale ?? "en";
  const t = settings[locale].export.google;
  if (!user?.googleRefreshToken) throw new GoogleError(t.notConnected, 401, true);
  const key = eq(googleSyncState.userId, id);
  const lease = randomUUID();
  const owns = and(key, eq(googleSyncState.lease, lease));
  db.insert(googleSyncState).values({ userId: id }).onConflictDoNothing().run();
  const state = db.update(googleSyncState).set({ lease, leaseUntil: Date.now() + LEASE })
    .where(and(key, lte(googleSyncState.leaseUntil, Date.now()))).returning().get();
  if (!state) throw new GoogleError(t.inProgress, 409, true);

  // SQLite also serializes workers in different Node processes. Renew around each network
  // request and fence all subsequent writes if the user disconnects or a lease expires.
  const guard = () => {
    if (!db.update(googleSyncState).set({ leaseUntil: Date.now() + LEASE }).where(owns).run().changes) {
      throw new GoogleError(t.notConnected, 409, true);
    }
  };
  try {
    let access: string;
    try {
      access = (await token({ grant_type: "refresh_token", refresh_token: user.googleRefreshToken })).access_token;
    } catch (e) {
      if (e instanceof GoogleError && e.reason === "invalid_grant") {
        guard();
        disconnectGoogle(id);
        throw new GoogleError(t.revoked, 401, true);
      }
      throw e;
    }
    async function api<T>(method: string, path: string, body?: unknown, etag?: string) {
      guard();
      const result = await call<T>(access, method, path, body, etag);
      guard();
      return result;
    }
    let calendarId = user.googleCalendarId;
    let cursor = state.cursor;
    if (calendarId) {
      const path = "/calendars/" + encodeURIComponent(calendarId);
      try {
        const calendar = await api<{ summary: string }>("GET", path);
        if (calendar.summary === "UPT Orar") await api("PATCH", path, { summary: "Poli" });
      } catch (e) {
        if (!absent(e)) throw e;
        calendarId = null;
      }
    }
    if (!calendarId) {
      const created = await api<{ id: string }>("POST", "/calendars", { summary: "Poli", timeZone: TIME_ZONE });
      if (!created.id) throw new Error("Google Calendar did not return a calendar ID.");
      calendarId = created.id;
      cursor = null;
      db.transaction(tx => {
        tx.delete(googleEventLinks).where(eq(googleEventLinks.userId, id)).run();
        tx.delete(googleExceptions).where(eq(googleExceptions.userId, id)).run();
        tx.update(googleSyncState).set({ cursor: null }).where(owns).run();
        tx.update(users).set({ googleCalendarId: calendarId }).where(eq(users.id, id)).run();
      });
    }
    const basePath = "/calendars/" + encodeURIComponent(calendarId) + "/events";
    const pathFor = (googleId: string) => basePath + "/" + encodeURIComponent(googleId);
    // A 412 means the event changed after the download. Fetch that change and perform
    // the three-way comparison again before retrying any conditional write.
    let count = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const events = new Map<string, GoogleEvent>();
      let pageToken: string | undefined;
      let next: string | undefined;
      try {
        do {
          const q = new URLSearchParams({ maxResults: "250", singleEvents: "false", showDeleted: "true" });
          if (cursor) q.set("syncToken", cursor);
          if (pageToken) q.set("pageToken", pageToken);
          const page = await api<EventPage>("GET", basePath + "?" + q);
          for (const event of page.items ?? []) events.set(event.id, event);
          pageToken = page.nextPageToken;
          next = page.nextSyncToken;
        } while (pageToken);
      } catch (e) {
        if (cursor && e instanceof GoogleError && e.status === 410) { cursor = null; attempt--; continue; }
        throw e;
      }
      if (!next) throw new Error("Google Calendar did not return a synchronization token.");
      const active = account()!;
      db.transaction(tx => {
        acceptChanges(active, locale, [...events.values()], !cursor);
        tx.update(googleSyncState).set({ cursor: next }).where(owns).run();
      });
      cursor = next;
      const local = sourceFields(active, locale);
      const links = db.select().from(googleEventLinks).where(eq(googleEventLinks.userId, id)).all();
      const linked = new Set(links.map(l => l.uid));
      for (const [uid, fields] of local) {
        if (linked.has(uid)) continue;
        // Allocate before POST. A lost response can be recovered using the same Google ID.
        links.push(db.insert(googleEventLinks).values({ userId: id, uid, googleId: randomUUID().replaceAll("-", ""), base: fields }).returning().get());
      }
      let raced = false;
      for (const link of links) {
        const where = linkKey(id, link.uid);
        const path = pathFor(link.googleId);
        const fields = local.get(link.uid);
        try {
          if (!fields) {
            if (link.remote?.status === "cancelled" && link.uid.startsWith("personal-")) continue;
            if (link.remote?.status !== "cancelled") {
              // Even a pending POST might have reached Google before the previous process exited.
              try { await api("DELETE", path, undefined, link.remote?.etag ?? "*"); }
              catch (e) { if (!absent(e)) throw e; guard(); }
            }
            if (link.uid.startsWith("personal-")) {
              db.update(googleEventLinks).set({ remote: { id: link.googleId, status: "cancelled" }, pending: null }).where(where).run();
            } else db.transaction(() => forgetLink(id, link));
          } else if (!link.remote) {
            db.update(googleEventLinks).set({ pending: fields }).where(where).run();
            const event = await api<GoogleEvent>("POST", basePath, {
              id: link.googleId, ...googleBody(fields), extendedProperties: { private: { uptOrar: link.uid } },
            });
            db.update(googleEventLinks).set({ base: fields, pending: null, remote: snapshot(event) }).where(where).run();
            count++;
          } else if (link.remote.status !== "cancelled") {
            const changed: Partial<CalendarFields> = {};
            const overrides = { ...link.overrides };
            for (const key of fieldNames) {
              if (equalField(key, fields, link.base)) continue;
              Object.assign(changed, { [key]: fields[key] });
              delete overrides[key];
            }
            if (!Object.keys(changed).length) continue;
            db.update(googleEventLinks).set({ pending: changed }).where(where).run();
            const event = await api<GoogleEvent>("PATCH", path, googleBody(changed, true), link.remote.etag);
            db.update(googleEventLinks).set({ base: fields, pending: null, remote: snapshot(event), overrides }).where(where).run();
            count++;
          }
        } catch (e) {
          if (!(e instanceof GoogleError) || !([409, 412].includes(e.status ?? 0) || absent(e))) throw e;
          let latest: GoogleEvent;
          try { latest = await api<GoogleEvent>("GET", path); }
          catch (readError) {
            if (!absent(readError)) throw readError;
            guard();
            latest = { id: link.googleId, status: "cancelled" };
          }
          if (!link.remote && latest.status !== "cancelled" && latest.extendedProperties?.private?.uptOrar !== link.uid) throw e;
          db.transaction(() => acceptChanges(account()!, locale, [latest], false));
          raced = true;
          break;
        }
      }
      if (raced) continue;
      const time = new Date().toISOString();
      guard();
      db.transaction(tx => {
        tx.update(users).set({ googleSyncedAt: time }).where(eq(users.id, id)).run();
        tx.update(googleSyncState).set({ failures: 0, nextAttempt: Date.now() + INTERVAL }).where(owns).run();
      });
      return { events: count, calendarId };
    }
    throw new GoogleError(t.tryAgain, 409, true);
  } catch (e) {
    const failures = state.failures + 1;
    db.update(googleSyncState).set({ failures, nextAttempt: Date.now() + Math.min(900_000, INTERVAL * 2 ** Math.min(failures - 1, 4)) }).where(owns).run();
    throw e;
  } finally {
    db.update(googleSyncState).set({ lease: null, leaseUntil: 0 }).where(owns).run();
  }
}

const running = new Map<string, Promise<Result>>();
export function syncToGoogle(user: Pick<User, "id">, locale?: Locale): Promise<Result> {
  const existing = running.get(user.id);
  if (existing) return existing;
  const promise = syncAccount(user.id, locale).finally(() => {
    if (running.get(user.id) === promise) running.delete(user.id);
  });
  running.set(user.id, promise);
  return promise;
}

export function googleSyncDelayed(userId: string) {
  const state = getDb().select({ failures: googleSyncState.failures }).from(googleSyncState).where(eq(googleSyncState.userId, userId)).get();
  return Boolean(state?.failures);
}

export function connectGoogle(userId: string, refreshToken: string) {
  running.delete(userId);
  getDb().transaction(tx => {
    tx.update(users).set({ googleRefreshToken: refreshToken }).where(eq(users.id, userId)).run();
    tx.update(googleSyncState).set({ lease: null, leaseUntil: 0, nextAttempt: 0, failures: 0 }).where(eq(googleSyncState.userId, userId)).run();
  });
}

export function disconnectGoogle(userId: string) {
  running.delete(userId);
  getDb().transaction(tx => {
    // Keep the calendar ID and links so reconnecting to the same account resumes in place.
    tx.update(users).set({ googleRefreshToken: null, googleSyncedAt: null }).where(eq(users.id, userId)).run();
    tx.update(googleSyncState).set({ lease: null, leaseUntil: 0, nextAttempt: 0 }).where(eq(googleSyncState.userId, userId)).run();
  });
}
