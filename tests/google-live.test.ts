import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { expect, it } from "vitest";
import { getDb } from "@/db";
import { personalEvents, users } from "@/db/schema";
import type { GoogleEvent } from "@/lib/calendar-types";
import { call, token } from "@/lib/google-api";
import { setGoogleSyncMode, syncToGoogle } from "@/lib/google";

process.env.DATABASE_PATH = ":memory:";
const grant = process.env.GOOGLE_CALENDAR_TEST_REFRESH_TOKEN;

// Opt in with a test OAuth grant. Every Google operation is scoped to a newly created
// secondary calendar. The grant and Google event contents are never logged.
it.skipIf(!grant || !process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET)(
  "round-trips creates, edits and deletes through the real Google Calendar API", async () => {
    const access = (await token({ grant_type: "refresh_token", refresh_token: grant! })).access_token;
    const cal = await call<{ id: string }>(access, "POST", "/calendars", {
      summary: "Poli sync test " + randomUUID(), timeZone: "Europe/Bucharest",
    });
    const path = "/calendars/" + encodeURIComponent(cal.id);
    try {
      const db = getDb();
      const user = db.insert(users).values({ id: randomUUID(), name: "Sync test", email: randomUUID() + "@example.invalid",
        passwordHash: "test", feedToken: randomUUID(), googleRefreshToken: grant, googleCalendarId: cal.id }).returning().get();
      setGoogleSyncMode(user.id, "two_way");
      const row = db.insert(personalEvents).values({ userId: user.id, title: "Created in Poli", date: "2027-03-08", startMin: 600, endMin: 660 }).returning().get();
      await syncToGoogle(user);
      const list = () => call<{ items: GoogleEvent[] }>(access, "GET", path + "/events");
      const event = (await list()).items.find(e => e.extendedProperties?.private?.uptOrar === "personal-" + row.id)!;
      expect(event?.summary).toBe("Created in Poli");
      const url = path + "/events/" + encodeURIComponent(event.id);
      await call(access, "PATCH", url, { summary: "Edited in Google" }, event.etag);
      await syncToGoogle(user);
      expect(db.select().from(personalEvents).where(eq(personalEvents.id, row.id)).get()?.title).toBe("Edited in Google");
      db.update(personalEvents).set({ location: "Poli room" }).where(eq(personalEvents.id, row.id)).run();
      await syncToGoogle(user);
      expect(await call<GoogleEvent>(access, "GET", url)).toMatchObject({ id: event.id, location: "Poli room" });
      await call(access, "DELETE", url);
      await syncToGoogle(user);
      expect(db.select().from(personalEvents).where(eq(personalEvents.id, row.id)).get()).toBeUndefined();
      const imported = await call<GoogleEvent>(access, "POST", path + "/events", {
        summary: "Created in Google", start: { date: "2027-03-10" }, end: { date: "2027-03-12" },
      });
      await syncToGoogle(user);
      const local = db.select().from(personalEvents).where(eq(personalEvents.userId, user.id)).get()!;
      expect(local).toMatchObject({ title: "Created in Google", date: "2027-03-10" });
      db.delete(personalEvents).where(eq(personalEvents.id, local.id)).run();
      await syncToGoogle(user);
      expect((await list()).items?.some(e => e.id === imported.id)).toBeFalsy();

      setGoogleSyncMode(user.id, "one_way");
      const separate = await call<GoogleEvent>(access, "POST", path + "/events", {
        summary: "Google-only while publishing", start: { date: "2027-03-14" }, end: { date: "2027-03-15" },
      });
      const published = db.insert(personalEvents).values({ userId: user.id, title: "Published from Poli", date: "2027-03-14", startMin: 600, endMin: 660 }).returning().get();
      await syncToGoogle(user);
      expect(db.select().from(personalEvents).where(eq(personalEvents.userId, user.id)).all()).toHaveLength(1);
      const copy = (await list()).items.find(e => e.extendedProperties?.private?.uptOrar === "personal-" + published.id)!;
      const copyUrl = path + "/events/" + encodeURIComponent(copy.id);
      await call(access, "PATCH", copyUrl, { summary: "Google edit in one-way" }, copy.etag);
      await syncToGoogle(user);
      expect(await call<GoogleEvent>(access, "GET", copyUrl)).toMatchObject({ summary: "Published from Poli" });
      setGoogleSyncMode(user.id, "two_way"); await syncToGoogle(user);
      expect(db.select().from(personalEvents).where(eq(personalEvents.userId, user.id)).all().map(e => e.title))
        .toContain(separate.summary);
    } finally {
      await call(access, "DELETE", path);
    }
  }, 120_000,
);
