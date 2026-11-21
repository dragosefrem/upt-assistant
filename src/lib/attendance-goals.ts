import "server-only";
import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { attendance, attendanceGoals, type EntryKind } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import type { User } from "./auth";
import { googleHiddenClasses } from "./google-schedule";
import { attendanceActivityId, kindOrder } from "./kinds";
import { currentSemester, studentWeek, type Semester } from "./schedule";

export interface AttendanceActivity {
  courseKey: string;
  kind: EntryKind;
  title: string;
  abbr: string | null;
  onTimetable: boolean;
  minimum: number | null;
  attended: number;
}

function semesterActivities(user: User, semester: Semester) {
  const activities = new Map<string, AttendanceActivity>();
  const saved = getDb().select().from(attendanceGoals)
    .where(and(eq(attendanceGoals.userId, user.id), eq(attendanceGoals.semesterId, semester.id))).all();
  for (const { courseKey, kind, title, minimum } of saved) {
    activities.set(attendanceActivityId({ courseKey, kind }), { courseKey, kind, title, abbr: null, minimum, attended: 0, onTimetable: false });
  }
  const hidden = new Set(googleHiddenClasses(user.id));
  for (const entry of studentWeek(user, semester)) {
    if (hidden.has(entry.entryId)) continue;
    const courseKey = `c:${entry.courseKey}`;
    const id = attendanceActivityId({ courseKey, kind: entry.kind });
    activities.set(id, {
      courseKey, kind: entry.kind, title: entry.title, abbr: entry.abbr,
      minimum: activities.get(id)?.minimum ?? null, attended: 0, onTimetable: true,
    });
  }
  return activities;
}

export function attendanceGoalOverview(user: User, semester: Semester | null, locale: Locale) {
  const activities = semester ? semesterActivities(user, semester) : new Map<string, AttendanceActivity>();
  if (activities.size) {
    const counts = getDb().select({ courseKey: attendance.courseKey, kind: attendance.kind, attended: count() })
      .from(attendance).where(and(eq(attendance.userId, user.id), eq(attendance.status, "attended")))
      .groupBy(attendance.courseKey, attendance.kind).all();
    for (const row of counts) {
      const activity = activities.get(attendanceActivityId(row));
      if (activity) activity.attended = row.attended;
    }
  }
  const sorted = [...activities.values()].sort((a, b) => a.title.localeCompare(b.title, locale) || kindOrder(a.kind) - kindOrder(b.kind));
  const goals = sorted.flatMap((activity) => activity.minimum === null ? [] : [
    { ...activity, minimum: activity.minimum, remaining: Math.max(0, activity.minimum - activity.attended) },
  ]);
  // Show reachable milestones first, then completed goals. Ties keep the alphabetical order.
  goals.sort((a, b) => Number(a.remaining === 0) - Number(b.remaining === 0) || a.remaining - b.remaining);
  return { goals, available: sorted.filter((activity) => activity.minimum === null) };
}

export type AttendanceGoalOverview = ReturnType<typeof attendanceGoalOverview>;

/** Resolve the activity against this student's own timetable or saved goals. Never take a title or user ID from the form. */
export function setAttendanceGoal(user: User, activityId: string, minimum: number | null) {
  if (minimum !== null && (!Number.isSafeInteger(minimum) || minimum < 1)) return "invalidMinimum";
  const semester = currentSemester();
  const activity = semester && semesterActivities(user, semester).get(activityId);
  if (!semester || !activity) return "unavailable";

  const db = getDb();
  const { courseKey, kind, title } = activity;
  if (minimum === null) {
    db.delete(attendanceGoals).where(and(
      eq(attendanceGoals.userId, user.id), eq(attendanceGoals.semesterId, semester.id),
      eq(attendanceGoals.courseKey, courseKey), eq(attendanceGoals.kind, kind),
    )).run();
  } else {
    db.insert(attendanceGoals).values({ userId: user.id, semesterId: semester.id, courseKey, kind, title, minimum })
      .onConflictDoUpdate({
        target: [attendanceGoals.userId, attendanceGoals.semesterId, attendanceGoals.courseKey, attendanceGoals.kind],
        set: { title, minimum },
      }).run();
  }
  return null;
}
