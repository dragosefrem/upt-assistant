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
