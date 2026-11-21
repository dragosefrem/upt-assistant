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
  occurrenceOverrides,
  personalEvents,
  semesters,
  specializations,
  userCourses,
  userOverrides,
  type AttendanceStatus,
  type EntryKind,
} from "@/db/schema";
import type { User } from "./auth";
import { sharedEventsFor } from "./group-events";
import { DAY_SHORT, addDays, daysBetween, describeWeeks, formatMinutes, mondayOf, occursInWeek, weekday } from "./time";

/** Everything the calendar, the assistant and the exports need to know about one event. */
export interface CalEvent {
  id: string;
  type: "class" | "exam" | "personal" | "shared";
  kind: EntryKind | "exam" | "personal" | "shared";
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
  groupEventId?: string;
  moved?: boolean;
  /** For a class moved for one week only: the date it would normally be on. */
  originalDate?: string;
  /**
   * Identifies the recurring series this occurrence belongs to, built from stable keys
   * so it survives re-scrapes. Together with `date` it identifies one occurrence.
   */
  seriesKey: string;
  /** Groups the series of one course (lecture, lab, …); equals `seriesKey` otherwise. */
  courseKey: string;
  attendance: AttendanceStatus | null;
}

/** A student's single-occurrence class moves, keyed by "entryId:originalDate". */
export function occurrenceMoves(userId: string) {
  const rows = getDb().select().from(occurrenceOverrides).where(eq(occurrenceOverrides.userId, userId)).all();
  return new Map(rows.map((o) => [`${o.entryId}:${o.date}`, o]));
}

export interface Place {
  name: string;
  address: string | null;
  lat: number;
  lng: number;
  approximate: boolean;
}

export type Semester = typeof semesters.$inferSelect & { weeks: string[] };

function withTeachingWeeks(row: typeof semesters.$inferSelect): Semester {
  return { ...row, weeks: JSON.parse(row.teachingWeeks) as string[] };
}

export function currentSemester(): Semester | null {
  const row = getDb().select().from(semesters).where(eq(semesters.isCurrent, true)).get();
  return row ? withTeachingWeeks(row) : null;
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
 * Published electives and courses marked optional by an administrator start
 * unticked. From year 3 students can also untick their other courses.
 */
export function courseChoices(user: Pick<User, "id" | "groupId" | "year">, semester: Semester): CourseChoice[] {
  if (!user.groupId) return [];
  const { rows } = loadGroup(user.groupId, semester.id);
  const picks = new Map(
    getDb().select().from(userCourses).where(eq(userCourses.userId, user.id)).all().map((p) => [p.courseId, p]),
  );
  const byCourse = new Map<number, CourseChoice>();
  const required = new Set(rows.filter((r) => !r.entry.publishedOptional).map((r) => r.course.id));
  for (const { entry, course } of rows) {
    let c = byCourse.get(course.id);
    if (!c) {
      const pick = picks.get(course.id);
      const optional = course.isOptional || !required.has(course.id);
      c = {
        courseId: course.id,
        name: course.name,
        abbr: course.abbreviation,
        isOptional: optional,
        selectable: optional || (user.year ?? 0) >= ELECTIVES_FROM_YEAR,
        enrolled: pick ? pick.enrolled : !optional,
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
      optionalCourse: choice.isOptional,
    });
  }
  return out.sort((a, b) => a.day - b.day || a.startMin - b.startMin);
}

/** The timetable every member of a group shares (no optional courses, no slot picks). */
export function groupWeek(groupId: number, semester: Semester): WeekEntry[] {
  return loadGroup(groupId, semester.id)
    .rows.filter(({ entry, course }) => !entry.isSlotOption && !entry.publishedOptional && !course.isOptional)
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

/** Expands the student's effective schedule into dated events. */
export function eventsBetween(user: Pick<User, "id" | "facultyId" | "specializationId" | "year" | "groupId">, from: string, to: string): CalEvent[] {
  const place = placeResolver(user.facultyId);
  const events: CalEvent[] = [];

  // Every term the range touches, up to the end of its exam session (dated meetings can fall there).
  const terms = user.groupId
    ? getDb().select().from(semesters).all().map(withTeachingWeeks)
        .filter((s) => s.startDate <= to && (s.examEnd && s.examEnd > s.endDate ? s.examEnd : s.endDate) >= from)
    : [];
  for (const semester of terms) {
    const week = studentWeek(user, semester);
    const once = occurrenceMoves(user.id);
    for (let date = from; date <= to; date = addDays(date, 1)) {
      // Weekly classes need a teaching week. A dated meeting can also fall in a break or the session.
      const n = date >= semester.startDate && date <= semester.endDate ? teachingWeek(semester, date) : null;
      const monday = mondayOf(date);
      const day = weekday(date);
      for (const e of week) {
        if (e.day !== day || !occursInWeek(e.weeks, n, monday)) continue;
        // Moved for this week only: it appears on its new date instead (below).
        if (once.has(`${e.entryId}:${date}`)) continue;
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
          note: [describeWeeks(e.weeks), e.endMin === e.startMin ? "End time unpublished" : null,
            e.moved ? "moved by you" : null, e.note].filter(Boolean).join(" · ") || null,
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
    const byEntry = new Map(week.map((e) => [e.entryId, e]));
    for (const o of once.values()) {
      const e = byEntry.get(o.entryId);
      if (!e || o.newDate < from || o.newDate > to) continue;
      const room = o.room ?? e.room;
      events.push({
        id: `e:${e.entryId}:${o.date}`,
        type: "class",
        kind: e.kind,
        title: e.title,
        abbr: e.abbr,
        date: o.newDate,
        startMin: o.startMin,
        endMin: o.endMin,
        room,
        teacher: e.teacher,
        note: `moved by you this week only (normally ${DAY_SHORT[weekday(o.date)]} ${o.date} ${formatMinutes(e.startMin)})`,
        place: place(room),
        entryId: e.entryId,
        courseId: e.courseId,
        moved: true,
        originalDate: o.date,
        seriesKey: `e:${e.entryKey}`,
        courseKey: `c:${e.courseKey}`,
        attendance: null,
      });
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
      note: [x.audience, x.endMin === x.startMin ? "End time unpublished" : null].filter(Boolean).join(" · ") || null,
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
      const span = daysBetween(from, to);
      const first = (p.day - weekday(from) + 7) % 7;
      for (let i = first; i <= span; i += 7) dates.push(addDays(from, i));
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

  for (const e of sharedEventsFor(user.id, from, to)) {
    events.push({
      id: `g:${e.id}`, groupEventId: e.id, type: "shared", kind: "shared", title: e.title,
      date: e.date, startMin: e.startMin, endMin: e.endMin, room: e.location,
      abbr: null, teacher: null, note: null, place: null,
      seriesKey: `g:${e.id}`, courseKey: `g:${e.id}`, attendance: null,
    });
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
      // Clip to the working day, so an evening event cannot produce a slot ending before it starts.
      const gapEnd = Math.min(b.startMin, dayEnd);
      if (gapEnd - cursor >= minMinutes) out.push({ date, startMin: cursor, endMin: gapEnd });
      cursor = Math.max(cursor, b.endMin);
    }
    if (dayEnd - cursor >= minMinutes) out.push({ date, startMin: cursor, endMin: dayEnd });
  }
  return out;
}

/** Whether two time ranges on the same day overlap; back-to-back ranges do not. */
export function overlaps(a: { startMin: number; endMin: number }, b: { startMin: number; endMin: number }): boolean {
  return a.startMin < b.endMin && b.startMin < a.endMin;
}

export interface SlotQuery {
  from: string;
  to: string;
  durationMin: number;
  /** Earliest start on any day. Default 08:00. */
  dayStart?: number;
  /** Latest end on any day. Default 20:00. */
  dayEnd?: number;
  /** Nothing is offered before this moment (normally "now"). */
  notBefore?: { date: string; minutes: number };
  /** Allowed weekdays, 1 = Monday … 7 = Sunday. Empty or missing means every day. */
  weekdays?: number[];
  /** Start times already offered or turned down. */
  exclude?: Array<{ date: string; startMin: number }>;
  /** How many options to return. Default 3. */
  count?: number;
}

/**
 * Concrete options for an activity of a given length, earliest first. Starts are
 * rounded up to the quarter hour, and every free gap contributes its earliest start
 * before any gap contributes a second one, so a short list spreads over different
 * parts of the week instead of offering 14:00, 15:00 and 16:00 of the same afternoon.
 */
export function suggestSlots(busy: Array<{ date: string; startMin: number; endMin: number }>, q: SlotQuery): FreeSlot[] {
  const { durationMin, dayStart = 8 * 60, dayEnd = 20 * 60, count = 3 } = q;
  const allowed = q.weekdays?.length ? new Set(q.weekdays) : null;
  const excluded = new Set((q.exclude ?? []).map((x) => `${x.date} ${x.startMin}`));
  const step = Math.max(durationMin, 60);

  const perGap: FreeSlot[][] = [];
  for (const gap of freeSlots(busy, q.from, q.to, { dayStart, dayEnd, minMinutes: durationMin, weekdaysOnly: false })) {
    if (allowed && !allowed.has(weekday(gap.date))) continue;
    let start = gap.startMin;
    if (q.notBefore) {
      if (gap.date < q.notBefore.date) continue;
      if (gap.date === q.notBefore.date) start = Math.max(start, q.notBefore.minutes);
    }
    start = Math.ceil(start / 15) * 15;
    const options: FreeSlot[] = [];
    for (let s = start; s + durationMin <= gap.endMin; s += step) {
      if (!excluded.has(`${gap.date} ${s}`)) options.push({ date: gap.date, startMin: s, endMin: s + durationMin });
    }
    if (options.length) perGap.push(options);
  }

  const picked: FreeSlot[] = [];
  for (let pass = 0; picked.length < count && perGap.some((o) => o.length > pass); pass++) {
    for (const options of perGap) {
      if (picked.length >= count) break;
      if (options[pass]) picked.push(options[pass]);
    }
  }
  return picked.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

/** Busy intervals of a whole group's shared timetable over a date range. */
export function groupBusy(groupId: number, from: string, to: string) {
  const semester = currentSemester();
  if (!semester) return [];
  const week = groupWeek(groupId, semester);
  const busy: Array<{ date: string; startMin: number; endMin: number; title: string }> = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    const n = teachingWeek(semester, date);
    const monday = mondayOf(date);
    for (const e of week) {
      if (e.day === weekday(date) && occursInWeek(e.weeks, n, monday)) {
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

