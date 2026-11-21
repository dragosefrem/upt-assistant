import Database from "better-sqlite3";
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { attendance, courses, entries, entryGroups, faculties, googleEventLinks, googleSyncState, groups, personalEvents, specializations, users } from "@/db/schema";
import { messages } from "@/i18n/messages";
import { getUser, type User } from "@/lib/auth";
import { markAttendance } from "@/lib/attendance";
import { attendanceGoalOverview, setAttendanceGoal } from "@/lib/attendance-goals";
import { attendanceActivityId } from "@/lib/kinds";
import { calendarSlices } from "@/lib/calendar-timing";
import type { GoogleEvent } from "@/lib/calendar-types";
import { connectGoogle, consentUrl, disconnectGoogle, googleSyncMode, setGoogleSyncMode, syncToGoogle } from "@/lib/google";
import { syncDueCalendars } from "@/lib/google-worker";
import { exportItems, toICS } from "@/lib/export";
import { currentSemester, eventsBetween, hiddenClasses, unhideClass } from "@/lib/schedule";
import { POST as schedule } from "@/app/api/schedule/route";
import { GET as eventsApi } from "@/app/api/events/route";
import { PATCH as saveDirection, POST as manualSync } from "@/app/api/google/sync/route";
import { GoogleCalendarFixture } from "./fixtures/google-calendar";

vi.mock("@/lib/auth", { spy: true });
vi.mock("@/i18n/server", () => ({ getT: () => messages.en, getLocale: () => "en" }));
process.env.DATABASE_PATH = ":memory:";

let user: User;
let google: GoogleCalendarFixture;
const db = getDb();
const date = "2026-11-23";
const point = (hour: number, day = date) => ({ dateTime: day + "T" + String(hour).padStart(2, "0") + ":00:00+02:00", timeZone: "Europe/Bucharest" });
const atGoogle = (id: string, summary = "Lunch"): GoogleEvent => ({ id, summary, start: point(12), end: point(13), location: "Canteen" });
const localRows = () => db.select().from(personalEvents).where(eq(personalEvents.userId, user.id)).all();
const sync = () => syncToGoogle(user);
async function change(action: string, data: Record<string, unknown>) {
  return schedule(new Request("http://localhost/api/schedule", { method: "POST", body: JSON.stringify({ action, ...data }) }));
}
const add = (title = "Gym") => change("addPersonal", { title, date, startMin: 600, endMin: 660, location: "Campus" });

beforeEach(() => {
  db.delete(users).run();
  user = db.insert(users).values({ id: "student", email: "student@test.invalid", name: "Student", passwordHash: "x", feedToken: "feed",
    googleRefreshToken: "fixture-refresh" }).returning().get();
  vi.mocked(getUser).mockResolvedValue(user);
  google = new GoogleCalendarFixture();
  vi.stubGlobal("fetch", google.fetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("Poli and Google Calendar", () => {
  beforeEach(() => setGoogleSyncMode(user.id, "two_way"));

  it("creates, edits and deletes through the authenticated app routes while retaining the Google event ID", async () => {
    expect((await add()).ok).toBe(true);
    expect((await manualSync()).ok).toBe(true);
    const first = google.live()[0];
    expect(first.summary).toBe("Gym");
    const row = localRows()[0];
    expect((await change("updatePersonal", { id: row.id, title: "Climbing", date, startMin: 720, endMin: 810, location: "Wall" })).ok).toBe(true);
    await sync();
    expect(google.live()).toHaveLength(1);
    expect(google.live()[0]).toMatchObject({ id: first.id, summary: "Climbing", location: "Wall" });
    expect(google.live()[0].start?.dateTime).toContain("T12:00");
    await sync();
    expect(google.writes).toEqual(["POST", "PATCH"]);
    await change("deletePersonal", { id: row.id });
    await sync();
    expect(google.live()).toHaveLength(0);
    await sync();
    expect(localRows()).toHaveLength(0);
  });

  it("updates a weekly Poli series in place and clears its repeat rule when changed to a one-off", async () => {
    await change("addPersonal", { title: "Weekly training", day: 3, startMin: 480, endMin: 540 });
    await sync();
    const first = google.live()[0];
    expect(first.recurrence?.[0]).toContain("FREQ=WEEKLY");
    await change("updatePersonal", { id: localRows()[0].id, title: "One training", date, startMin: 600, endMin: 660 });
    await sync();
    expect(google.live()).toHaveLength(1);
    expect(google.live()[0]).toMatchObject({ id: first.id, summary: "One training", recurrence: [] });
    expect(eventsBetween(user, date, "2026-12-30")).toHaveLength(1);
  });

  it("imports a new Google event into the calendar API and sends edits of that same event back to Google", async () => {
    google.put(atGoogle("from-google"));
    await syncDueCalendars(); // There is no browser or manual request to start this sync.
    const row = localRows()[0];
    const res = await eventsApi(new Request("http://localhost/api/events?from=" + date));
    expect((await res.json()).events).toEqual([expect.objectContaining({ title: "Lunch", personalId: row.id, startMin: 720 })]);
    await change("updatePersonal", { id: row.id, title: "Lunch with Ana", location: "Terrace" });
    await sync();
    expect(google.live()[0]).toMatchObject({ id: "from-google", summary: "Lunch with Ana", location: "Terrace" });
    google.put({ ...google.live()[0], summary: "Late lunch", start: point(14), end: point(15), description: "Bring notes" });
    await sync();
    expect(localRows()[0]).toMatchObject({ id: row.id, title: "Late lunch", startMin: 840, description: "Bring notes" });
    google.remove("from-google");
    await sync();
    await sync();
    expect(localRows()).toHaveLength(0);
    expect(google.live()).toHaveLength(0);
  });

  it("publishes Poli's 15-minute alert and preserves reminders the student chose in Google", async () => {
    const custom = { useDefault: false, overrides: [{ method: "popup", minutes: 45 }] };
    google.put({ ...atGoogle("custom"), reminders: custom });
    google.put({ ...atGoogle("default"), reminders: { useDefault: true } });
    await add("Poli appointment");
    await sync();
    await sync();
    expect(google.events.get("custom")?.reminders).toEqual(custom);
    expect(google.events.get("default")?.reminders).toEqual({ useDefault: true });
    const published = google.live().find(e => e.summary === "Poli appointment")!;
    expect(published.reminders).toEqual({ useDefault: false, overrides: [{ method: "popup", minutes: 15 }] });
    expect(google.writes).toEqual(["POST"]);

    google.put({ ...published, reminders: custom });
    await sync();
    // The calendar branch used the calendar default as the local baseline before 15-minute alerts shipped.
    const link = db.select().from(googleEventLinks).where(eq(googleEventLinks.googleId, published.id)).get()!;
    db.update(googleEventLinks).set({ base: { ...link.base, reminders: { useDefault: true } } })
      .where(eq(googleEventLinks.googleId, published.id)).run();
    await sync();
    expect(google.events.get(published.id)?.reminders).toEqual(custom);
    expect(exportItems(user).find(item => item.uid === link.uid)?.alarms).toEqual([45]);
  });

  it("merges independent changes, honors remote same-field edits and recovers an ETag race during upload", async () => {
    await add(); await sync();
    const row = localRows()[0];
    const event = google.live()[0];
    await change("updatePersonal", { id: row.id, title: "Local title", location: "Local room" });
    google.put({ ...event, summary: "Google title" });
    await sync();
    expect(google.live()[0]).toMatchObject({ summary: "Google title", location: "Local room" });
    expect(localRows()[0]).toMatchObject({ title: "Google title", location: "Local room" });
    await change("updatePersonal", { id: row.id, title: "Final title", location: "Local room" });
    google.beforePatch = id => google.put({ ...google.events.get(id)!, location: "Late Google room" });
    await sync();
    expect(google.live()[0]).toMatchObject({ summary: "Final title", location: "Late Google room" });
    expect(localRows()[0].location).toBe("Late Google room");
  });

  it("recovers an accepted insert with a lost response and coalesces overlapping sync requests", async () => {
    await add();
    google.loseInsertResponse = true;
    await expect(sync()).rejects.toThrow("Connection closed");
    await Promise.all([sync(), sync(), sync()]);
    expect(google.live()).toHaveLength(1);
    expect(google.writes).toEqual(["POST"]);
    expect(localRows()).toHaveLength(1);
  });

  it("preserves a newer local edit after a lost PATCH response and reimports a restored item once", async () => {
    await add(); await sync();
    const row = localRows()[0];
    const id = google.live()[0].id;
    await change("updatePersonal", { id: row.id, title: "First edit" });
    google.losePatchResponse = true;
    await expect(sync()).rejects.toThrow("Lost PATCH");
    await change("updatePersonal", { id: row.id, title: "Second edit" });
    await sync();
    expect(google.live()[0].summary).toBe("Second edit");
    const saved = google.live()[0];
    google.remove(id); await sync();
    expect(localRows()).toHaveLength(0);
    google.put({ ...saved, status: "confirmed" }); await sync(); await sync();
    expect(localRows()).toHaveLength(1);
    expect(localRows()[0].title).toBe("Second edit");
    expect(google.live().map(e => e.id)).toEqual([id]);
  });

  it("consumes every page atomically and rebuilds an expired token without resurrecting deletions", async () => {
    await sync();
    google.pageSize = 1;
    google.put(atGoogle("one")); google.put(atGoogle("two", "Dinner"));
    google.failPage = true;
    await expect(sync()).rejects.toThrow();
    expect(localRows()).toHaveLength(0);
    expect(db.select().from(googleSyncState).get()?.cursor).toBe("0");
    google.failPage = false;
    await sync();
    expect(localRows()).toHaveLength(2);
    google.events.delete("one"); // A full listing might no longer include an old tombstone.
    google.put({ ...google.events.get("two")!, location: "Cafe" });
    google.minCursor = google.version;
    await sync();
    expect(localRows()).toHaveLength(1);
    expect(localRows()[0]).toMatchObject({ title: "Dinner", location: "Cafe" });
  });

  it("adopts an earlier export in place, resumes after disconnect, and retains data if access is revoked", async () => {
    await add();
    const row = localRows()[0];
    google.put({ ...atGoogle("legacy", "Edited before upgrade"), extendedProperties: { private: { uptOrar: "personal-" + row.id } } });
    await sync();
    expect(localRows()).toHaveLength(1);
    expect(localRows()[0].title).toBe("Edited before upgrade");
    expect(google.writes).toEqual([]);
    disconnectGoogle(user.id);
    google.put({ ...google.live()[0], summary: "While disconnected" });
    await syncDueCalendars();
    expect(localRows()[0].title).toBe("Edited before upgrade");
    db.update(users).set({ googleRefreshToken: "new" }).where(eq(users.id, user.id)).run();
    await sync();
    expect(localRows()[0].title).toBe("While disconnected");
    google.invalidGrant = true;
    await expect(sync()).rejects.toThrow(/revoked/);
    expect(db.select().from(users).get()?.googleRefreshToken).toBeNull();
    expect(localRows()).toHaveLength(1);
    expect(new URL(consentUrl("state")).searchParams.get("scope")).toBe("https://www.googleapis.com/auth/calendar.app.created");
  });

  it("keeps multi-day all-day dates exclusive in Google and editable in Poli", async () => {
    google.put({ id: "trip", summary: "Trip", start: { date }, end: { date: "2026-11-26" } });
    await sync();
    expect(eventsBetween(user, date, "2026-11-27").map(e => [e.date, e.allDay, e.endMin])).toEqual([
      [date, true, 1440], ["2026-11-24", true, 1440], ["2026-11-25", true, 1440],
    ]);
    const row = localRows()[0];
    await change("updatePersonal", { id: row.id, title: "Weekend", date: "2026-11-27", endDate: "2026-11-28", allDay: true, startMin: 0, endMin: 1440 });
    await sync();
    expect(google.live()[0]).toMatchObject({ id: "trip", start: { date: "2026-11-27" }, end: { date: "2026-11-29" } });
  });

  it("expands recurrence across DST and applies moved and cancelled instances only to their original occurrence", async () => {
    const base: GoogleEvent = { id: "series", summary: "Practice", start: point(9), end: point(10), recurrence: ["RRULE:FREQ=WEEKLY;COUNT=4"] };
    google.put(base);
    google.put({ id: "moved", recurringEventId: base.id, originalStartTime: point(9, "2026-11-30"), summary: "Later",
      start: point(11, "2026-12-02"), end: point(12, "2026-12-02") });
    google.put({ id: "cancelled", status: "cancelled", recurringEventId: base.id, originalStartTime: point(9, "2026-12-07") });
    await sync();
    expect(eventsBetween(user, date, "2026-12-20").map(e => [e.date, e.title])).toEqual([
      [date, "Practice"], ["2026-12-02", "Later"], ["2026-12-14", "Practice"],
    ]);
    const feed = toICS(exportItems(user));
    expect(feed).toContain("EXDATE;TZID=Europe/Bucharest:20261130T090000");
    expect(feed).toContain("EXDATE;TZID=Europe/Bucharest:20261207T090000");
    expect(feed).toContain("SUMMARY:Later");
    await change("updatePersonal", { id: localRows()[0].id, title: "Rehearsal" });
    await sync();
    expect(google.events.get("series")?.recurrence).toEqual(base.recurrence);
    const slices = calendarSlices({ start: { dateTime: "2026-03-06T09:00:00", timeZone: "America/New_York" },
      end: { dateTime: "2026-03-06T10:00:00", timeZone: "America/New_York" },
      recurrence: ["RRULE:FREQ=WEEKLY;COUNT=5", "EXDATE:20260320T130000Z"] }, "2026-03-01", "2026-04-11");
    expect(slices.map(s => [s.date, s.startMin])).toEqual([["2026-03-06", 960], ["2026-03-13", 900], ["2026-03-27", 900], ["2026-04-03", 960]]);
  });

  it("keeps changes to a published class and a single moved class private to the connected student", async () => {
    const sem = currentSemester()!;
    const faculty = db.insert(faculties).values({ slug: "test-cal", name: "Engineering" }).returning().get();
    const spec = db.insert(specializations).values({ facultyId: faculty.id, degree: "bachelor", slug: "test", name: "Test" }).returning().get();
    const group = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "1" }).returning().get();
    const course = db.insert(courses).values({ key: "sync-course", semesterId: sem.id, facultyId: faculty.id, name: "Design", year: 1 }).returning().get();
    const entry = db.insert(entries).values({ key: "sync-entry", courseId: course.id, semesterId: sem.id, rawText: "Design", kind: "course", day: 1, startMin: 600, endMin: 660, weeks: "all" }).returning().get();
    db.insert(entryGroups).values({ entryId: entry.id, groupId: group.id }).run();
    user = db.update(users).set({ facultyId: faculty.id, specializationId: spec.id, groupId: group.id, year: 1 }).where(eq(users.id, user.id)).returning().get();
    const other = { ...user, id: "colleague" };
    const goalId = attendanceActivityId({ courseKey: "c:" + course.key, kind: entry.kind });
    expect(setAttendanceGoal(user, goalId, 4)).toBeNull();
    await sync();
    const master = google.live().find(e => e.extendedProperties?.private?.uptOrar === "entry-" + entry.id)!;
    const first = master.start!.dateTime!.slice(0, 10);
    const orig = eventsBetween(other, first, sem.endDate).filter(e => e.entryId === entry.id);
    expect(orig.length).toBeGreaterThan(2);
    const [a, b, c] = orig;
    const localPoint = (day: string, hour: number) => ({ dateTime: day + "T" + hour + ":00:00", timeZone: "Europe/Bucharest" });
    google.put({ ...master, summary: "My Design" });
    google.put({ id: "class-move", recurringEventId: master.id, originalStartTime: localPoint(b.date, 10), summary: "Tutorial",
      start: localPoint(c.date, 13), end: localPoint(c.date, 14) });
    await sync();
    expect(eventsBetween(user, a.date, c.date).map(e => [e.date, e.startMin, e.title])).toEqual([
      [a.date, 600, "My Design"], [c.date, 600, "My Design"], [c.date, 780, "Tutorial"],
    ]);
    expect(eventsBetween(other, a.date, c.date).map(e => e.title)).toEqual(["Design", "Design", "Design"]);
    const sessions = () => eventsBetween(user, c.date, c.date);
    const [regular, moved] = sessions();
    // A mark saved before this merge only identifies the series, date and displayed time.
    db.insert(attendance).values({ userId: user.id, seriesKey: regular.seriesKey, courseKey: regular.courseKey,
      date: c.date, kind: regular.kind, title: regular.title, startMin: regular.startMin, endMin: regular.endMin, status: "attended" }).run();
    expect(sessions().map(e => e.attendance)).toEqual(["attended", null]);
    expect(markAttendance(user, { eventId: moved.id, date: c.date, status: "attended" }, c.date).ok).toBe(true);
    expect(attendanceGoalOverview(user, sem, "en").goals[0].attended).toBe(2);
    expect(markAttendance(user, { eventId: regular.id, date: c.date, status: null }, c.date).ok).toBe(true);
    expect(sessions().map(e => e.attendance)).toEqual([null, "attended"]);
    expect(attendanceGoalOverview(user, sem, "en").goals[0].attended).toBe(1);
    google.remove(master.id);
    await sync(); await sync();
    expect(eventsBetween(user, a.date, c.date)).toHaveLength(0);
    expect(eventsBetween(other, a.date, c.date)).toHaveLength(3);
    expect(db.select().from(googleEventLinks).where(eq(googleEventLinks.userId, user.id)).all()).toHaveLength(1);
    expect(hiddenClasses(user.id, sem.id).map(e => e.id)).toEqual([entry.id]);
    expect(attendanceGoalOverview(user, sem, "en").goals).toMatchObject([{ minimum: 4, onTimetable: false }]);
    expect(unhideClass(user.id, entry.id)).toBe(true);
    await sync();
    expect(google.live().some(e => e.extendedProperties?.private?.uptOrar === "entry-" + entry.id)).toBe(true);
    expect(eventsBetween(user, a.date, c.date).map(e => e.title)).toEqual(["Design", "Design", "Design"]);
    expect(attendanceGoalOverview(user, sem, "en").goals).toMatchObject([{ minimum: 4, onTimetable: true }]);
  });

  it("enforces account ownership for imported events", async () => {
    google.put(atGoogle("private"));
    await sync();
    const row = localRows()[0];
    vi.mocked(getUser).mockResolvedValue({ ...user, id: "other" });
    expect((await change("updatePersonal", { id: row.id, title: "Changed" })).status).toBe(404);
    await change("deletePersonal", { id: row.id });
    expect(localRows()[0].title).toBe("Lunch");
    expect(eventsBetween({ ...user, id: "other" }, date, date)).toEqual([]);
  });
});

function choose(mode: unknown) {
  return saveDirection(new Request("http://localhost/api/google/sync", { method: "PATCH", body: JSON.stringify({ mode }) }));
}

describe("Google Calendar sync direction", () => {
  it("migrates existing two-way accounts without opting legacy exporters or new accounts into imports", () => {
    const old = new Database(":memory:");
    try {
      const files = readdirSync("drizzle").filter(f => f.endsWith(".sql")).sort();
      for (const name of files.filter(n => n < "0008")) old.exec(readFileSync("drizzle/" + name, "utf8"));
      for (const id of ["two", "legacy"]) old.prepare("INSERT INTO users (id, name, email, password_hash, feed_token, google_refresh_token) VALUES (?, ?, ?, 'x', ?, 'grant')").run(id, id, id + "@example.test", id);
      old.exec("INSERT INTO google_sync_state (user_id, cursor) VALUES ('two','earlier-cursor')");
      old.exec(readFileSync("drizzle/0008_google_sync_direction.sql", "utf8"));
      old.exec("INSERT INTO google_sync_state (user_id) VALUES ('legacy')");
      expect(old.prepare("SELECT user_id,mode,cursor FROM google_sync_state ORDER BY user_id").all()).toEqual([
        { user_id: "legacy", mode: "one_way", cursor: null }, { user_id: "two", mode: "two_way", cursor: null },
      ]);
    } finally { old.close(); }
  });

  it("defaults to publishing, repairs Google edits or deletions of Poli events and leaves unrelated events alone", async () => {
    expect(googleSyncMode(user.id)).toBe("one_way");
    google.put(atGoogle("google-only", "Private appointment"));
    await add();
    await syncDueCalendars();
    const first = google.live().find(e => e.summary === "Gym")!;
    const row = localRows()[0];
    expect(localRows().map(r => r.title)).toEqual(["Gym"]);
    google.put({ ...first, summary: "Edited at Google", location: "Other room" });
    await manualSync();
    expect(google.events.get(first.id)).toMatchObject({ summary: "Gym", location: "Campus" });
    expect(localRows()[0]).toMatchObject({ id: row.id, title: "Gym", location: "Campus" });
    google.remove(first.id);
    await sync();
    const restored = google.live().find(e => e.summary === "Gym")!;
    expect(restored.id).not.toBe(first.id);
    await change("updatePersonal", { id: row.id, title: "Training", location: "Park" });
    await sync();
    expect(google.events.get(restored.id)).toMatchObject({ summary: "Training", location: "Park" });
    await sync();
    expect(google.writes).toEqual(["POST", "PATCH", "POST", "PATCH"]);
    await change("deletePersonal", { id: row.id }); await sync();
    expect(google.live().map(e => e.id)).toEqual(["google-only"]);
    expect(localRows()).toHaveLength(0);
  });

  it("pauses previously imported Google events and catches up on changes and deletions after switching back", async () => {
    google.put(atGoogle("import-me")); google.put(atGoogle("remove-me", "Practice"));
    await add("From Poli"); await sync();
    const published = google.live().find(e => e.summary === "From Poli")!.id;
    expect((await choose("two_way")).status).toBe(200);
    await syncDueCalendars();
    expect(localRows()).toHaveLength(3);
    const imported = localRows().find(r => r.title === "Lunch")!;
    expect((await choose("one_way")).status).toBe(200);
    google.put({ ...google.events.get("import-me")!, summary: "Renamed while paused" });
    google.remove("remove-me");
    google.put(atGoogle("new-while-paused", "New from Google"));
    await change("updatePersonal", { id: imported.id, title: "Lunch", location: "Local edit while paused" });
    await sync(); await sync();
    expect(localRows().map(r => r.title).sort()).toEqual(["From Poli", "Lunch", "Practice"]);
    expect(google.events.get("import-me")).toMatchObject({ summary: "Renamed while paused", location: "Canteen" });
    await choose("two_way"); await sync(); await sync();
    expect(localRows().map(r => r.title).sort()).toEqual(["From Poli", "New from Google", "Renamed while paused"]);
    expect(localRows().find(r => r.id === imported.id)?.location).toBe("Local edit while paused");
    expect(google.events.get("import-me")?.location).toBe("Local edit while paused");
    expect(google.live().find(e => e.summary === "From Poli")?.id).toBe(published);
    expect(google.live()).toHaveLength(3);
  });

  it("adopts a tagged legacy export without importing Google-origin items or duplicating a lost insert", async () => {
    await add();
    const uid = "personal-" + localRows()[0].id;
    google.put({ ...atGoogle("legacy", "Old Google edit"), extendedProperties: { private: { uptOrar: uid } } });
    google.put(atGoogle("original"));
    await sync();
    expect(google.events.get("legacy")?.summary).toBe("Gym");
    expect(localRows()).toHaveLength(1);
    await add("Second");
    google.loseInsertResponse = true;
    await expect(sync()).rejects.toThrow("Connection closed");
    await sync();
    expect(google.live().filter(e => e.summary === "Second")).toHaveLength(1);
    expect(localRows()).toHaveLength(2);
    // Upgrade a connection with links created before the origin column existed.
    await choose("two_way"); await sync();
    db.update(googleEventLinks).set({ origin: null }).run();
    await choose("one_way");
    google.put({ ...google.events.get("original")!, summary: "Still Google-owned" });
    await sync();
    expect(google.events.get("original")?.summary).toBe("Still Google-owned");
    expect(localRows().some(r => r.title === "Still Google-owned")).toBe(false);
  });

  it("never claims an unrelated resource which shares the ID of an unacknowledged insert", async () => {
    await add();
    google.loseInsertResponse = true;
    await expect(sync()).rejects.toThrow();
    const mistakenId = google.live()[0].id;
    google.put(atGoogle(mistakenId, "Unrelated Google item"));
    await sync(); await sync();
    expect(google.events.get(mistakenId)?.summary).toBe("Unrelated Google item");
    expect(google.live().map(e => e.summary).sort()).toEqual(["Gym", "Unrelated Google item"]);
    expect(localRows().map(r => r.title)).toEqual(["Gym"]);
  });

  it("repairs an externally moved or cancelled occurrence of a published recurring event", async () => {
    await change("addPersonal", { title: "Practice", day: 1, startMin: 540, endMin: 600 });
    await sync();
    const master = google.live()[0];
    const original = master.start!;
    google.put({ id: "drift", recurringEventId: master.id, originalStartTime: original,
      summary: "Remote move", start: point(13), end: point(14) });
    await sync();
    expect(google.events.get("drift")?.summary).toBe("Practice");
    expect(google.events.get("drift")?.start).toMatchObject(original);
    google.remove("drift"); await sync();
    expect(google.events.get("drift")).toMatchObject({ status: "confirmed", summary: "Practice" });
    expect(localRows()).toHaveLength(1);
    expect(eventsBetween(user, date, date).map(e => e.title)).toEqual(["Practice"]);
    const writes = [...google.writes]; await sync(); expect(google.writes).toEqual(writes);
  });

  it("does not let an in-flight two-way download import after switching to one-way", async () => {
    await choose("two_way"); await sync();
    google.put(atGoogle("late"));
    let release!: () => void;
    let reached!: () => void;
    const waiting = new Promise<void>(r => { reached = r; });
    const resume = new Promise<void>(r => { release = r; });
    let hold = true;
    vi.stubGlobal("fetch", async (input: string | URL | Request, init?: RequestInit) => {
      const response = await google.fetch(input, init);
      if (hold && String(input).includes("/events?")) { hold = false; reached(); await resume; }
      return response;
    });
    const old = sync();
    await waiting;
    expect((await choose("one_way")).ok).toBe(true);
    const next = sync();
    release();
    await expect(old).rejects.toThrow();
    await next;
    expect(localRows()).toHaveLength(0);
    expect(google.live().map(e => e.id)).toEqual(["late"]);
  });

  it("keeps Google-origin local copies private to Poli when switching one-way to a replacement calendar", async () => {
    await choose("two_way");
    google.put(atGoogle("previous-google-original"));
    await add("Published event"); await sync();
    await choose("one_way");
    db.update(users).set({ googleCalendarId: "calendar-that-no-longer-exists" }).where(eq(users.id, user.id)).run();
    google = new GoogleCalendarFixture(); vi.stubGlobal("fetch", google.fetch);
    await sync();
    expect(localRows().map(r => r.title).sort()).toEqual(["Lunch", "Published event"]);
    expect(google.live().map(e => e.summary)).toEqual(["Published event"]);
  });

  it("validates and persists account-specific preferences before connecting and across reconnects", async () => {
    disconnectGoogle(user.id);
    expect((await choose("both")).status).toBe(400);
    expect((await choose("two_way")).ok).toBe(true);
    expect(googleSyncMode("another-student")).toBe("one_way");
    expect(googleSyncMode(user.id)).toBe("two_way");
    connectGoogle(user.id, "fixture-refresh");
    await sync(); disconnectGoogle(user.id);
    expect(googleSyncMode(user.id)).toBe("two_way");
    vi.mocked(getUser).mockResolvedValue(null);
    expect((await choose("one_way")).status).toBe(401);
    expect(googleSyncMode(user.id)).toBe("two_way");
  });
});
