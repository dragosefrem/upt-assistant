import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db";
import {
  attendance,
  buildings,
  courses,
  entries,
  entryGroups,
  examSpecializations,
  exams,
  faculties,
  groups,
  personalEvents,
  semesters,
  specializations,
  userCourses,
  userOverrides,
  type AttendanceStatus,
  type EntryKind,
} from "@/db/schema";
import type { User } from "./auth";
import { addDays, daysBetween, describeWeeks, mondayOf, weekMatches, weekday } from "./time";

/** Everything the calendar, the assistant and the exports need to know about one event. */
export interface CalEvent {
  id: string;
  type: "class" | "exam" | "personal";
  kind: EntryKind | "exam" | "personal";
  title: string;
  abbr: string | null;
  date: string;
  startMin: number;
  endMin: number;
  room: string | null;
  teacher: string | null;
  note: string | null;
  place: Place | null;
  entryId?: number;
  courseId?: number;
  examId?: number;
  personalId?: number;
  moved?: boolean;
  /**
   * Identifies the recurring series this occurrence belongs to, built from stable keys
   * so it survives re-scrapes. Together with `date` it identifies one occurrence.
   */
  seriesKey: string;
  /** Groups the series of one course (lecture, lab, …); equals `seriesKey` otherwise. */
  courseKey: string;
  attendance: AttendanceStatus | null;
}

export interface Place {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  approximate: boolean;
}

export type Semester = typeof semesters.$inferSelect & { weeks: string[] };

export function currentSemester(): Semester | null {
  const row = getDb().select().from(semesters).where(eq(semesters.isCurrent, true)).get();
  return row ? { ...row, weeks: JSON.parse(row.teachingWeeks) as string[] } : null;
}

/** 1-based teaching week containing `date`, or null during holidays and sessions. */
export function teachingWeek(semester: Semester, date: string): number | null {
  const index = semester.weeks.indexOf(mondayOf(date));
  return index === -1 ? null : index + 1;
}

/* ───────────────────────────── Places ───────────────────────────── */

export function placeResolver(facultyId: number | null) {
  const db = getDb();
  const rules = db.select().from(buildings).orderBy(asc(buildings.priority)).all();
  const faculty = facultyId ? db.select().from(faculties).where(eq(faculties.id, facultyId)).get() : undefined;
  const acronym = faculty?.shortName?.toLowerCase() ?? "";
  const compiled = rules.flatMap((b) => {
    if (!b.roomPattern) return [];
    const scope = b.scope.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
    if (scope.length && !scope.includes(acronym)) return [];
    try {
      return [{ building: b, re: new RegExp(b.roomPattern, "i") }];
    } catch {
      return [];
    }
  });
  return (room: string | null): Place | null => {
    if (room) {
      const hit = compiled.find((c) => c.re.test(room.trim()));
      if (hit) {
        if (hit.building.code === "ONLINE") return null;
        return {
          name: hit.building.name,
          address: hit.building.address,
          lat: hit.building.lat,
          lng: hit.building.lng,
          approximate: /approx/i.test(hit.building.notes ?? ""),
        };
      }
    }
    // An unrecognised room is most likely in the student's own faculty building.
    if (faculty?.lat != null && faculty.lng != null) {
      return { name: faculty.name, address: faculty.address, lat: faculty.lat, lng: faculty.lng, approximate: true };
    }
    return null;
  };
}

/* ───────────────────────────── A student's week ───────────────────────────── */

export interface WeekEntry {
  entryId: number;
  entryKey: string;
  courseId: number;
  courseKey: string;
  title: string;
  abbr: string | null;
  kind: EntryKind;
  day: number;
  startMin: number;
  endMin: number;
  weeks: string;
  room: string | null;
  teacher: string | null;
  note: string | null;
  moved: boolean;
  optionalCourse: boolean;
}

export interface CourseChoice {
  courseId: number;
  name: string;
  abbr: string | null;
  isOptional: boolean;
  /** Whether the student may leave this course out of their timetable. */
  selectable: boolean;
  enrolled: boolean;
  /** Alternative slots (usually labs); the student attends exactly one. */
  slots: Array<{ entryId: number; kind: EntryKind; day: number; startMin: number; endMin: number; room: string | null }>;
  chosenSlotId: number | null;
  fixedCount: number;
}

interface GroupData {
  rows: Array<{ entry: typeof entries.$inferSelect; course: typeof courses.$inferSelect }>;
}

function loadGroup(groupId: number, semesterId: number): GroupData {
  const rows = getDb()
    .select({ entry: entries, course: courses })
    .from(entryGroups)
    .innerJoin(entries, eq(entries.id, entryGroups.entryId))
    .innerJoin(courses, eq(courses.id, entries.courseId))
    .where(and(eq(entryGroups.groupId, groupId), eq(entries.semesterId, semesterId)))
    .all();
  return { rows };
}

/** Electives start in year 3 of a bachelor's programme (and run through master's). */
const ELECTIVES_FROM_YEAR = 3;

/**
 * Per-course choices for a student: which courses they follow and which alternative
 * slot they attend.
 *
 * Timetables do not say which courses are elective, so from year 3 on every course can
 * be unticked. Courses an admin has marked optional start unticked for everyone.
 */
export function courseChoices(user: Pick<User, "id" | "groupId" | "year">, semester: Semester): CourseChoice[] {
  if (!user.groupId) return [];
  const { rows } = loadGroup(user.groupId, semester.id);
  const picks = new Map(
    getDb().select().from(userCourses).where(eq(userCourses.userId, user.id)).all().map((p) => [p.courseId, p]),
  );
  const byCourse = new Map<number, CourseChoice>();
  for (const { entry, course } of rows) {
    let c = byCourse.get(course.id);
    if (!c) {
      const pick = picks.get(course.id);
      c = {
        courseId: course.id,
        name: course.name,
        abbr: course.abbreviation,
        isOptional: course.isOptional,
        selectable: course.isOptional || (user.year ?? 0) >= ELECTIVES_FROM_YEAR,
        enrolled: pick ? pick.enrolled : !course.isOptional,
        slots: [],
        chosenSlotId: pick?.slotEntryId ?? null,
        fixedCount: 0,
      };
      byCourse.set(course.id, c);
    }
    if (entry.isSlotOption) {
      c.slots.push({ entryId: entry.id, kind: entry.kind, day: entry.day, startMin: entry.startMin, endMin: entry.endMin, room: entry.room });
    } else c.fixedCount++;
  }
  for (const c of byCourse.values()) {
    c.slots.sort((a, b) => a.day - b.day || a.startMin - b.startMin);
    if (c.chosenSlotId && !c.slots.some((s) => s.entryId === c.chosenSlotId)) c.chosenSlotId = null;
  }
  return [...byCourse.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The student's effective weekly timetable after choices and personal overrides. */
export function studentWeek(user: Pick<User, "id" | "groupId" | "year">, semester: Semester): WeekEntry[] {
  if (!user.groupId) return [];
  const { rows } = loadGroup(user.groupId, semester.id);
  const choices = new Map(courseChoices(user, semester).map((c) => [c.courseId, c]));
  const overrides = new Map(
    getDb().select().from(userOverrides).where(eq(userOverrides.userId, user.id)).all().map((o) => [o.entryId, o]),
  );
  const out: WeekEntry[] = [];
  for (const { entry, course } of rows) {
    const choice = choices.get(course.id)!;
    if (!choice.enrolled) continue;
    if (entry.isSlotOption && choice.chosenSlotId !== entry.id) continue;
    const o = overrides.get(entry.id);
    if (o?.hidden) continue;
    const moved = !!o && (o.day != null || o.startMin != null || o.room != null);
    out.push({
      entryId: entry.id,
      entryKey: entry.key,
      courseId: course.id,
      courseKey: course.key,
      title: course.name,
      abbr: course.abbreviation,
      kind: entry.kind,
      day: o?.day ?? entry.day,
      startMin: o?.startMin ?? entry.startMin,
      endMin: o?.endMin ?? entry.endMin,
      weeks: entry.weeks,
      room: o?.room ?? entry.room,
      teacher: entry.teacher,
      note: o?.note ?? null,
      moved,
      optionalCourse: course.isOptional,
    });
  }
  return out.sort((a, b) => a.day - b.day || a.startMin - b.startMin);
}

/** The timetable every member of a group shares (no optional courses, no slot picks). */
export function groupWeek(groupId: number, semester: Semester): WeekEntry[] {
  return loadGroup(groupId, semester.id)
    .rows.filter(({ entry, course }) => !entry.isSlotOption && !course.isOptional)
    .map(({ entry, course }) => ({
      entryId: entry.id,
      entryKey: entry.key,
      courseId: course.id,
      courseKey: course.key,
      title: course.name,
      abbr: course.abbreviation,
      kind: entry.kind,
      day: entry.day,
      startMin: entry.startMin,
      endMin: entry.endMin,
      weeks: entry.weeks,
      room: entry.room,
      teacher: entry.teacher,
      note: null,
      moved: false,
      optionalCourse: false,
    }));
}

/* ───────────────────────────── Exams ───────────────────────────── */

export function examsForUser(user: Pick<User, "specializationId" | "year">, from?: string, to?: string) {
  if (!user.specializationId || !user.year) return [];
  return getDb()
    .select({ exam: exams })
    .from(examSpecializations)
    .innerJoin(exams, eq(exams.id, examSpecializations.examId))
    .where(
      and(
        eq(examSpecializations.specializationId, user.specializationId),
        eq(exams.year, user.year),
        from ? gte(exams.date, from) : undefined,
        to ? lte(exams.date, to) : undefined,
      ),
    )
    .orderBy(asc(exams.date), asc(exams.startMin))
    .all()
    .map((r) => r.exam);
}

/* ───────────────────────────── Calendar events ───────────────────────────── */

/** Expands the weekly timetable, exams and personal events into dated events. */
export function eventsBetween(user: User, from: string, to: string): CalEvent[] {
  const semester = currentSemester();
  const place = placeResolver(user.facultyId);
  const events: CalEvent[] = [];

  if (semester && user.groupId) {
    const week = studentWeek(user, semester);
    for (let date = from; date <= to; date = addDays(date, 1)) {
      const n = teachingWeek(semester, date);
      if (n === null || date < semester.startDate || date > semester.endDate) continue;
      const day = weekday(date);
      for (const e of week) {
        if (e.day !== day || !weekMatches(e.weeks, n)) continue;
        events.push({
          id: `e:${e.entryId}:${date}`,
          type: "class",
          kind: e.kind,
          title: e.title,
          abbr: e.abbr,
          date,
          startMin: e.startMin,
          endMin: e.endMin,
          room: e.room,
          teacher: e.teacher,
          note: [describeWeeks(e.weeks), e.moved ? "moved by you" : null, e.note].filter(Boolean).join(" · ") || null,
          place: place(e.room),
          entryId: e.entryId,
          courseId: e.courseId,
          moved: e.moved,
          seriesKey: `e:${e.entryKey}`,
          courseKey: `c:${e.courseKey}`,
          attendance: null,
        });
      }
    }
  }

  for (const x of examsForUser(user, from, to)) {
    events.push({
      id: `x:${x.id}`,
      type: "exam",
      kind: "exam",
      title: x.courseName,
      abbr: x.courseAbbr,
      date: x.date,
      startMin: x.startMin,
      endMin: x.endMin,
      room: x.room,
      teacher: x.teacher,
      note: x.audience,
      place: place(x.room),
      examId: x.id,
      seriesKey: `x:${x.key}`,
      courseKey: `x:${x.key}`,
      attendance: null,
    });
  }

  const personal = getDb().select().from(personalEvents).where(eq(personalEvents.userId, user.id)).all();
  for (const p of personal) {
    const dates: string[] = [];
    if (p.date) {
      if (p.date >= from && p.date <= to) dates.push(p.date);
    } else if (p.day) {
      for (let date = from; date <= to; date = addDays(date, 1)) if (weekday(date) === p.day) dates.push(date);
    }
    for (const date of dates) {
      events.push({
        id: `p:${p.id}:${date}`,
        type: "personal",
        kind: "personal",
        title: p.title,
        abbr: null,
        date,
        startMin: p.startMin,
        endMin: p.endMin,
        room: p.location,
        teacher: null,
        note: p.date ? null : "every week",
        place: null,
        personalId: p.id,
        seriesKey: `p:${p.id}`,
        courseKey: `p:${p.id}`,
        attendance: null,
      });
    }
  }

  const marks = new Map(
    getDb()
      .select({ seriesKey: attendance.seriesKey, date: attendance.date, status: attendance.status })
      .from(attendance)
      .where(and(eq(attendance.userId, user.id), gte(attendance.date, from), lte(attendance.date, to)))
      .all()
      .map((m) => [`${m.seriesKey}|${m.date}`, m.status]),
  );
  for (const e of events) e.attendance = marks.get(`${e.seriesKey}|${e.date}`) ?? null;

  return events.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.endMin - b.endMin);
}

/* ───────────────────────────── Free time ───────────────────────────── */

export interface FreeSlot {
  date: string;
  startMin: number;
  endMin: number;
}

/** Gaps of at least `minMinutes` between busy intervals, inside the working day. */
export function freeSlots(
  busy: Array<{ date: string; startMin: number; endMin: number }>,
  from: string,
  to: string,
  opts: { dayStart?: number; dayEnd?: number; minMinutes?: number; weekdaysOnly?: boolean } = {},
): FreeSlot[] {
  const { dayStart = 8 * 60, dayEnd = 20 * 60, minMinutes = 60, weekdaysOnly = true } = opts;
  const out: FreeSlot[] = [];
  const span = Math.min(daysBetween(from, to), 60);
  for (let i = 0; i <= span; i++) {
    const date = addDays(from, i);
    if (weekdaysOnly && weekday(date) > 5) continue;
    const day = busy.filter((b) => b.date === date).sort((a, b) => a.startMin - b.startMin);
    let cursor = dayStart;
    for (const b of day) {
      if (b.startMin - cursor >= minMinutes) out.push({ date, startMin: cursor, endMin: Math.min(b.startMin, dayEnd) });
      cursor = Math.max(cursor, b.endMin);
    }
    if (dayEnd - cursor >= minMinutes) out.push({ date, startMin: cursor, endMin: dayEnd });
  }
  return out;
}

/** Busy intervals of a whole group's shared timetable over a date range. */
export function groupBusy(groupId: number, from: string, to: string) {
  const semester = currentSemester();
  if (!semester) return [];
  const week = groupWeek(groupId, semester);
  const busy: Array<{ date: string; startMin: number; endMin: number; title: string }> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const n = teachingWeek(semester, date);
    if (n === null) continue;
    for (const e of week) {
      if (e.day === weekday(date) && weekMatches(e.weeks, n)) {
        busy.push({ date, startMin: e.startMin, endMin: e.endMin, title: e.title });
      }
    }
  }
  return busy;
}

/* ───────────────────────────── Lookups for pickers ───────────────────────────── */

export function describeGroup(groupId: number | null) {
  if (!groupId) return null;
  const row = getDb()
    .select({ group: groups, spec: specializations, faculty: faculties })
    .from(groups)
    .innerJoin(specializations, eq(specializations.id, groups.specializationId))
    .innerJoin(faculties, eq(faculties.id, specializations.facultyId))
    .where(eq(groups.id, groupId))
    .get();
  if (!row) return null;
  const label = [row.group.series, row.group.name].filter(Boolean).join(" · ") || "whole year";
  return { ...row, label };
}

/** Finds groups by a loose text query ("TI 3.2", "calculatoare anul 3 grupa 1.1"). */
export function findGroups(query: string, facultyId: number | null, preferYear: number | null = null, limit = 8) {
  const all = getDb()
    .select({ group: groups, spec: specializations })
    .from(groups)
    .innerJoin(specializations, eq(specializations.id, groups.specializationId))
    .where(facultyId ? eq(specializations.facultyId, facultyId) : undefined)
    .all();
  const tokens = query.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").split(/[^a-z0-9.]+/).filter(Boolean);
  const scored = all
    .map((r) => {
      const hay = `${r.spec.name} ${r.spec.code ?? ""} ${r.group.series} ${r.group.name} an ${r.group.year} year ${r.group.year}`
        .toLowerCase()
        .normalize("NFD")
        .replace(/[̀-ͯ]/g, "");
      const words = hay.split(/[^a-z0-9.]+/);
      let score = tokens.reduce((n, t) => n + (words.includes(t) ? 2 : hay.includes(t) ? 1 : 0), 0);
      // "TI 3.2" exists in several years; a student most likely means their own.
      if (score > 0 && preferYear && r.group.year === preferYear) score += 0.5;
      return { ...r, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}

