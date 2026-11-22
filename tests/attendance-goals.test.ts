import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { courses, entries, entryGroups, faculties, groups, semesters, specializations, userOverrides, users, type EntryKind } from "@/db/schema";
import { attendanceRecords, markAttendance } from "@/lib/attendance";
import { attendanceGoalOverview, setAttendanceGoal } from "@/lib/attendance-goals";
import type { User } from "@/lib/auth";
import { attendanceActivityId } from "@/lib/kinds";
import { currentSemester, eventsBetween } from "@/lib/schedule";

process.env.DATABASE_PATH = ":memory:";
const courseKey = "c:physics-fall";
const id = (kind: EntryKind) => attendanceActivityId({ courseKey, kind });
let course: typeof courses.$inferSelect;
let groupId: number;
let user: User;

function addEntry(key: string, kind: EntryKind, day: number) {
  const db = getDb();
  const row = db.insert(entries).values({
    key, kind, day, semesterId: course.semesterId, courseId: course.id,
    startMin: 540, endMin: 660, rawText: key,
  }).returning().get();
  db.insert(entryGroups).values({ entryId: row.id, groupId }).run();
  return row;
}

function student(group: number | null = groupId) {
  const key = randomUUID();
  return getDb().insert(users).values({
    id: key, name: "Student", email: `${key}@example.test`, passwordHash: "test", feedToken: key, groupId: group, year: 1,
  }).returning().get();
}

const overview = (who = user) => attendanceGoalOverview(who, currentSemester(), "en");

function mark(who: User, date: string, status: "attended" | "missed" | null) {
  const event = eventsBetween(who, date, date).find((e) => e.courseKey === courseKey)!;
  expect(markAttendance(who, { eventId: event.id, date, status }, "2026-11-20")).toMatchObject({ ok: true });
}

describe("semester attendance goals", () => {
  beforeAll(() => {
    const db = getDb();
    db.update(semesters).set({ isCurrent: false }).run();
    db.update(semesters).set({ isCurrent: true }).where(eq(semesters.number, 1)).run();
    const faculty = db.insert(faculties).values({ slug: "ac", name: "AC" }).returning().get();
    const spec = db.insert(specializations).values({ facultyId: faculty.id, degree: "bachelor", name: "CTI", slug: "cti" }).returning().get();
    groupId = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "1.1" }).returning().get().id;
    course = db.insert(courses).values({ key: "physics-fall", semesterId: currentSemester()!.id, facultyId: faculty.id, name: "Physics" }).returning().get();
    addEntry("lecture", "course", 1);
    addEntry("first-lab", "lab", 2);
    addEntry("second-lab", "lab", 4);
    addEntry("seminar", "seminar", 3);
  });
  beforeEach(() => { user = student(); });

  it("counts the sessions still to come and says when a minimum can no longer be reached", () => {
    // Sunday 22 November 2026, after week 8 of 14. The lecture is on Mondays: six teaching
    // Mondays remain, and 30 November is a public holiday.
    const sunday = { date: "2026-11-22", minutes: 12 * 60 };
    const at = (now: { date: string; minutes: number }) => attendanceGoalOverview(user, currentSemester(), "en", now).goals;
    expect(setAttendanceGoal(user, id("course"), 7)).toBeNull();
    expect(setAttendanceGoal(user, id("seminar"), 3)).toBeNull();
    const [seminar, lecture] = at(sunday);
    // Seven are needed and five are to come. The eight past lectures carry no mark yet, and the
    // student may have been to them: that is a nudge to mark them, not a missed minimum.
    expect(lecture).toMatchObject({ kind: "course", remaining: 7, sessionsToCome: 5, unmarkedPast: 8, needsPastMarks: true, outOfReach: false });
    // Wednesdays: 25 Nov, 2, 9, 16 Dec, 13 and 20 Jan. Three more are well within reach.
    expect(seminar).toMatchObject({ kind: "seminar", remaining: 3, sessionsToCome: 6, needsPastMarks: false, outOfReach: false });
    // A session counts until it ends, and nothing is left after the last teaching day.
    expect(at({ date: "2027-01-18", minutes: 8 * 60 }).find((g) => g.kind === "course")).toMatchObject({ sessionsToCome: 1 });
    expect(at({ date: "2027-01-18", minutes: 23 * 60 }).find((g) => g.kind === "course")).toMatchObject({ sessionsToCome: 0, unmarkedPast: 13, outOfReach: false });
    expect(at({ date: "2027-02-01", minutes: 0 }).find((g) => g.kind === "seminar")).toMatchObject({ sessionsToCome: 0 });

    // Once the past lectures are marked, what is left decides. Seven missed and one attended:
    // six more are needed, five are to come and none is unmarked.
    const mondays = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"];
    mondays.forEach((date, i) => mark(user, date, i === 0 ? "attended" : "missed"));
    expect(at(sunday).find((g) => g.kind === "course")).toMatchObject({ attended: 1, remaining: 6, sessionsToCome: 5, unmarkedPast: 0, needsPastMarks: false, outOfReach: true });
    // A goal the sessions to come cover is neither.
    expect(setAttendanceGoal(user, id("course"), 6)).toBeNull();
    expect(at(sunday).find((g) => g.kind === "course")).toMatchObject({ remaining: 5, sessionsToCome: 5, needsPastMarks: false, outOfReach: false });
  });

  it("offers the student's classes before any marks and keeps separate minima for different kinds", () => {
    expect(overview().available.map((a) => [a.kind, a.attended])).toEqual([["course", 0], ["seminar", 0], ["lab", 0]]);
    expect(setAttendanceGoal(user, id("course"), 8)).toBeNull();
    expect(setAttendanceGoal(user, id("lab"), 5)).toBeNull();
    expect(setAttendanceGoal(user, id("lab"), 4)).toBeNull();
    const { goals, available } = overview();
    expect(goals.map((g) => [g.kind, g.minimum, g.remaining])).toEqual([["lab", 4, 4], ["course", 8, 8]]);
    expect(available.map((a) => a.kind)).toEqual(["seminar"]);
    expect(overview(student()).goals).toEqual([]);
    expect(setAttendanceGoal(student(null), id("course"), 5)).toBe("unavailable");
    for (const invalid of [0, -1, 0.5, NaN, Infinity]) {
      expect(setAttendanceGoal(user, id("lab"), invalid)).toBe("invalidMinimum");
    }
    expect(overview().goals[0].minimum).toBe(4);
  });

  it("counts existing marks across slots, applies corrections and shows unfinished goals first", () => {
    mark(user, "2026-11-10", "attended"); // Tuesday lab
    mark(user, "2026-11-12", "attended"); // Thursday lab
    mark(user, "2026-11-16", "attended"); // Monday lecture
    mark(student(), "2026-11-19", "attended");
    setAttendanceGoal(user, id("course"), 4);
    setAttendanceGoal(user, id("lab"), 2);
    expect(overview().goals.map((g) => [g.kind, g.attended, g.remaining])).toEqual([["course", 1, 3], ["lab", 2, 0]]);
    mark(user, "2026-11-17", "attended");
    expect(overview().goals[1]).toMatchObject({ attended: 3, remaining: 0 });
    mark(user, "2026-11-17", "missed");
    mark(user, "2026-11-10", null);
    expect(overview().goals[0]).toMatchObject({ kind: "lab", attended: 1, remaining: 1 });
    const history = attendanceRecords(user.id);
    expect(setAttendanceGoal(user, id("lab"), null)).toBeNull();
    expect(overview().available.find((a) => a.kind === "lab")?.attended).toBe(1);
    expect(attendanceRecords(user.id)).toEqual(history);
  });

  it("keeps a saved goal when its entry disappears or is reimported in another slot", () => {
    const original = addEntry("project", "project", 5);
    setAttendanceGoal(user, id("project"), 3);
    mark(user, "2026-11-06", "attended");
    getDb().delete(entries).where(eq(entries.id, original.id)).run();
    expect(overview().goals[0]).toMatchObject({ title: "Physics", onTimetable: false, attended: 1, remaining: 2 });
    const moved = addEntry("project", "project", 6);
    mark(user, "2026-11-14", "attended");
    expect(overview().goals).toMatchObject([{ onTimetable: true, attended: 2, remaining: 1 }]);
    getDb().insert(userOverrides).values({ userId: user.id, entryId: moved.id, hidden: true }).run();
    expect(setAttendanceGoal(user, id("project"), null)).toBeNull();
    expect(overview().available.some((a) => a.kind === "project")).toBe(false);
    getDb().delete(entries).where(eq(entries.id, moved.id)).run();
  });

  it("starts the next semester with its own goals and keeps past marks in history", () => {
    setAttendanceGoal(user, id("lab"), 4);
    mark(user, "2026-11-10", "attended");
    const db = getDb();
    db.update(semesters).set({ isCurrent: false }).where(eq(semesters.number, 1)).run();
    db.update(semesters).set({ isCurrent: true }).where(eq(semesters.number, 2)).run();
    try {
      expect(overview()).toEqual({ goals: [], available: [] });
      expect(setAttendanceGoal(user, id("lab"), 9)).toBe("unavailable");
      expect(attendanceRecords(user.id)).toHaveLength(1);
    } finally {
      db.update(semesters).set({ isCurrent: false }).where(eq(semesters.number, 2)).run();
      db.update(semesters).set({ isCurrent: true }).where(eq(semesters.number, 1)).run();
    }
    expect(overview().goals[0]).toMatchObject({ minimum: 4, remaining: 3 });
  });
});
