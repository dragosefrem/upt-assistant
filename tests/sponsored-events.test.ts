import { randomBytes, randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cancelSponsoredEvent, checkSponsoredAvailability, publishSponsoredEvent } from "@/app/admin/sponsored-events/actions";
import { GET as calendar } from "@/app/api/events/route";
import { POST as changeSchedule } from "@/app/api/schedule/route";
import { getDb } from "@/db";
import {
  courses, entries, entryGroups, eventParticipants, exams, examSpecializations, faculties, groupEvents, groups,
  occurrenceOverrides, personalEvents, semesters, specializations, sponsoredEvents, users,
} from "@/db/schema";
import { messages } from "@/i18n/messages";
import { attendanceRecords, markAttendance, seriesDetails, summarizeAttendance } from "@/lib/attendance";
import { getUser, requireAdmin, type User } from "@/lib/auth";
import { exportItems } from "@/lib/export";
import { calendarWithOffers, readSponsoredSlot, respondToSponsoredEvent, sponsoredReach } from "@/lib/sponsored-events";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth", async (load) => ({ ...(await load<typeof import("@/lib/auth")>()), getUser: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en", getT: async () => messages.en }));

const date = "2026-11-25"; // Wednesday in a teaching week
const interval = { date, startMin: 720, endMin: 780 };
let student: User;
let admin: User;
let other: User;
let faculty: number;
let secondFaculty: number;
let group: number;
let spec: number;

beforeAll(() => {
  vi.stubEnv("DATABASE_PATH", ":memory:");
  vi.useFakeTimers({ toFake: ["Date"] });
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

beforeEach(() => {
  vi.setSystemTime(new Date("2026-11-23T08:00:00Z"));
  vi.stubGlobal("__uptDb", undefined);
  const db = getDb();
  faculty = db.insert(faculties).values({ name: "Engineering", slug: "eng" }).returning().get().id;
  secondFaculty = db.insert(faculties).values({ name: "Arts", slug: "arts" }).returning().get().id;
  spec = db.insert(specializations).values({ facultyId: faculty, degree: "bachelor", name: "Software", slug: "software" }).returning().get().id;
  group = db.insert(groups).values({ specializationId: spec, year: 2, name: "2.1" }).returning().get().id;
  function account(id: string, values: Partial<User> = {}) {
    return db.insert(users).values({ id, name: id, email: `${id}@example.org`, passwordHash: "fixture", feedToken: id,
      facultyId: faculty, specializationId: spec, groupId: group, year: 2, onboardedAt: "2026-09-01", ...values }).returning().get();
  }
  student = account("ana");
  other = account("dan", { facultyId: secondFaculty, year: 3, groupId: null, specializationId: null });
  admin = account("admin", { role: "admin" });
  account("onboarding", { onboardedAt: null });
  vi.mocked(getUser).mockResolvedValue(student);
  vi.mocked(requireAdmin).mockResolvedValue(admin);
});

function offer(title: string, patch: Partial<typeof sponsoredEvents.$inferInsert> = {}) {
  return getDb().insert(sponsoredEvents).values({ id: randomBytes(32).toString("hex"), creatorId: admin.id, title, sponsor: "Campus Partner",
    description: "Workshop", location: "A101", facultyIds: [], years: [], ...interval, ...patch }).returning().get();
}
function form() {
  const data = new FormData();
  for (const [key, value] of Object.entries({ draftId: randomUUID(), title: "Design lab", sponsor: "Campus Partner", location: "", description: "",
    date, start: "12:00", end: "13:00", faculty: String(faculty), year: "2" })) data.set(key, value);
  return data;
}
function view(user = student, from = date, to = from) {
  return calendarWithOffers(user, from, to, "en");
}
function respond(id: string, choice: string) {
  return changeSchedule(new Request("http://localhost/api/schedule", { method: "POST", body: JSON.stringify({ action: "sponsored", id, choice }) }));
}

it("publishes once per submission and authorizes preview, publishing and cancellation on the server", async () => {
  const draft = form();
  expect(await checkSponsoredAvailability(draft)).toEqual({ total: 1, free: 1 });
  for (let i = 0; i < 2; i++) await expect(publishSponsoredEvent(null, draft)).rejects.toThrow("NEXT_REDIRECT");
  expect(getDb().select().from(sponsoredEvents).all()).toMatchObject([{ creatorId: admin.id, facultyIds: [faculty], years: [2] }]);
  for (const action of [() => publishSponsoredEvent(null, form()), () => checkSponsoredAvailability(draft),
    () => cancelSponsoredEvent(view().offers[0].id)]) {
    vi.mocked(requireAdmin).mockRejectedValueOnce(new Error("admin access required"));
    await expect(action()).rejects.toThrow("admin access required");
  }
  expect(view().offers.map((e) => e.title)).toEqual(["Design lab"]);
  draft.set("title", "Career fair");
  await expect(publishSponsoredEvent(null, draft)).rejects.toThrow("NEXT_REDIRECT");
  expect(view().offers.map((e) => e.title)).toEqual(["Career fair", "Design lab"]);
});

it("rejects invalid dates, campus DST gaps, past slots, reversed times and invalid audience values", async () => {
  for (const [key, value] of [["start", "13:00"], ["end", "25:00"], ["date", "2026-02-30"], ["date", "2026-11-22"],
    ["year", "7"], ["faculty", "999999"], ["faculty", ""], ["title", "  "]]) {
    const data = form();
    data.set(key, value);
    expect(await publishSponsoredEvent(null, data)).toHaveProperty("error");
  }
  const gap = form();
  gap.set("date", "2027-03-28"); gap.set("start", "03:15"); gap.set("end", "04:30");
  expect(readSponsoredSlot(gap)).toEqual({ error: "time" });
  expect(getDb().select().from(sponsoredEvents).all()).toEqual([]);
});

it("matches any selected faculty and any selected year, including unrestricted dimensions", async () => {
  offer("All");
  offer("Arts", { facultyIds: [secondFaculty] });
  offer("Third years", { years: [3] });
  offer("Combined", { facultyIds: [secondFaculty, faculty], years: [1, 2] });
  offer("Other combination", { facultyIds: [secondFaculty], years: [2] });
  const request = new Request(`http://localhost/api/events?from=${date}&offers=1`);
  const data = await (await calendar(request)).json();
  expect(data.offers.map((e: { title: string }) => e.title)).toEqual(["All", "Combined"]);
  expect(data.offers[0]).not.toHaveProperty("facultyIds");
  expect(view(other).offers.map((e) => e.title)).toEqual(["All", "Arts", "Third years"]);
  expect(view(admin).offers).toEqual([]);
  expect(view({ ...student, onboardedAt: null }).offers).toEqual([]);
  vi.mocked(getUser).mockResolvedValue(null);
  expect((await calendar(request)).status).toBe(401);
});

it("uses the effective calendar including moved classes, recurring and dated personal events, exams and accepted group holds", async () => {
  const db = getDb();
  const term = db.select().from(semesters).where(eq(semesters.isCurrent, true)).get()!;
  const course = db.insert(courses).values({ key: "course", name: "Graphics", semesterId: term.id, facultyId: faculty }).returning().get();
  const entry = db.insert(entries).values({ key: "lecture", kind: "course", courseId: course.id, semesterId: term.id, day: 3,
    startMin: 540, endMin: 600, rawText: "Graphics" }).returning().get();
  db.insert(entryGroups).values({ groupId: group, entryId: entry.id }).run();
  db.insert(occurrenceOverrides).values({ entryId: entry.id, userId: student.id, date, newDate: "2026-11-26", startMin: 540, endMin: 600 }).run();
  const exam = db.insert(exams).values({ key: "exam", facultyId: faculty, year: 2, courseName: "Exam", date, startMin: 600, endMin: 660, rawText: "" }).returning().get();
  db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec }).run();
  db.insert(personalEvents).values([
    { userId: student.id, title: "Weekly lunch", day: 3, startMin: 720, endMin: 750 },
    { userId: student.id, title: "Study", date, startMin: 780, endMin: 840 },
  ]).run();
  for (const [id, startMin, status] of [["pending", 900, "pending"], ["confirmed", 1020, "confirmed"]] as const) {
    db.insert(groupEvents).values({ id, title: id, creatorId: student.id, date, startMin, endMin: startMin + 60, deadline: Date.now() + 86_400_000, status }).run();
    db.insert(eventParticipants).values([{ eventId: id, userId: student.id, response: "accepted" },
      { eventId: id, userId: other.id, response: status === "confirmed" ? "accepted" : "pending" }]).run();
  }
  offer("Before exam", { startMin: 540, endMin: 600 });
  offer("After exam", { startMin: 660, endMin: 720 });
  for (const [startMin, endMin] of [[599, 601], [749, 769], [790, 810], [910, 930], [1030, 1060]]) offer("Clash", { startMin, endMin });
  offer("Moved class clash", { date: "2026-11-26", startMin: 550, endMin: 590 });
  expect(view(student, date, "2026-11-26").offers.map((e) => e.title)).toEqual(["Before exam", "After exam"]);
  expect(await sponsoredReach({ ...interval, facultyIds: [], years: [] })).toEqual({ total: 2, free: 1 });
});

it("checks eligibility again at save time and treats only explicit saves as calendar and export items", async () => {
  const first = offer("Design lab", { facultyIds: [faculty], years: [2] });
  const second = offer("Robotics");
  expect(view().events).toEqual([]);
  expect(exportItems(student)).toEqual([]);
  expect(respondToSponsoredEvent(other.id, first.id, "save")).toBe(false);
  getDb().update(users).set({ year: 3 }).where(eq(users.id, student.id)).run();
  expect((await respond(first.id, "save")).status).toBe(409);
  getDb().update(users).set({ year: 2 }).where(eq(users.id, student.id)).run();
  const lunch = getDb().insert(personalEvents).values({ userId: student.id, title: "Late change", ...interval }).returning().get();
  expect((await respond(first.id, "save")).status).toBe(409);
  getDb().delete(personalEvents).where(eq(personalEvents.id, lunch.id)).run();
  expect((await respond(first.id, "save")).status).toBe(200);
  expect((await respond(first.id, "save")).status).toBe(200);
  expect((await respond(second.id, "save")).status).toBe(409);
  expect(view().offers).toEqual([]);
  expect(view().events).toMatchObject([{ sponsoredEventId: first.id, kind: "sponsored" }]);
  expect(exportItems(student, "ro")).toMatchObject([{ title: "Design lab", description: "Sponsorizat de Campus Partner · Workshop" }]);
  expect(respondToSponsoredEvent(other.id, first.id, "remove")).toBe(true);
  expect(view().events).toHaveLength(1);
  await respond(first.id, "remove");
  await respond(first.id, "hide");
  expect(view().offers.map((e) => e.id)).toEqual([second.id]);
  expect(view().events).toEqual([]);
  await respond(first.id, "undoHide");
  expect(view().offers).toHaveLength(2);
  await respond(first.id, "save");
  await cancelSponsoredEvent(first.id);
  expect(view().events).toEqual([]);
  expect(exportItems(student)).toEqual([]);
  expect((await respond(first.id, "save")).status).toBe(409);
});

it("keeps a start-only entry's published minute busy and allows an event ending exactly then", () => {
  const db = getDb();
  const exam = db.insert(exams).values({ key: "oral", facultyId: faculty, year: 2, courseName: "Oral exam",
    date, startMin: 720, endMin: 720, rawText: "12:00" }).returning().get();
  db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec }).run();
  offer("Before", { startMin: 660, endMin: 720 });
  offer("Same start");
  expect(view().offers.map((e) => e.title)).toEqual(["Before"]);
});

it("keeps the sponsor and location available in attendance details for an event the student saved", () => {
  const event = offer("Portfolio review");
  expect(respondToSponsoredEvent(student.id, event.id, "save")).toBe(true);
  vi.setSystemTime(new Date(date + "T17:00:00Z"));
  const [occurrence] = view().events;
  expect(markAttendance(student, { eventId: occurrence.id, date, status: "attended" }, date).ok).toBe(true);
  const { series } = summarizeAttendance(attendanceRecords(student.id));
  expect(seriesDetails(student, series).get(series[0].key)).toMatchObject({
    source: "timetable", title: event.title, room: "A101", note: "Sponsored by Campus Partner · Workshop", place: null,
  });
});

it("surfaces next week's suggestions on the home week while keeping the displayed schedule in range, and expires them at the start", () => {
  const next = offer("Next week", { date: "2026-12-04" });
  offer("Later", { date: "2027-02-05" });
  const week = view(student, "2026-11-23", "2026-11-29");
  expect(week.offers.map((e) => e.id)).toEqual([next.id]);
  expect(week.events).toEqual([]);
  expect(view(student, "2027-02-05").offers.map((e) => e.title)).toEqual(["Later"]);
  vi.setSystemTime(new Date("2026-12-04T10:00:00Z"));
  expect(view(student, next.date).offers).toEqual([]);
  expect(respondToSponsoredEvent(student.id, next.id, "save")).toBe(false);
});
