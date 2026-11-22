import "server-only";
import { campusRoomSite } from "./campuspath/known-room";
import { examAudience } from "./exam-audience";
import { and, asc, desc, eq, gte, inArray, lte } from "drizzle-orm";
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
import type { Locale } from "@/i18n/config";
import { common } from "@/i18n/messages/common";
import { calendar as calendarMessages } from "@/i18n/messages/calendar";
import type { User } from "./auth";
import { campusRoomCode } from "./campuspath/known-room";
import { sharedEventsFor } from "./group-events";
import { isPublicHoliday } from "./holidays";
import { calendarSlices, editorInterval } from "./calendar-timing";
import { applyGoogleSchedule, googleHiddenClasses, resetGoogleClass } from "./google-schedule";
import { addDays, dayName, daysBetween, describeWeeks, formatMinutes, isDatedMeeting, mondayOf, occursInWeek, weekday } from "./time";

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
  allDay?: boolean;
  privateCalendarEdit?: boolean;
  occurrence?: string;
  personalEditor?: { title: string; location: string; weekly: boolean; pattern: boolean;
    interval?: { date: string; endDate: string; startMin: number; endMin: number; allDay: boolean } };
  groupEventId?: string;
  campusRoom?: string;
  moved?: boolean;
  /** For a class moved for one week only: the date it would normally be on. */
  originalDate?: string;
  /** The entry repeats and can be rescheduled as a series. */
  recurring?: boolean;
  /**
   * Identifies the recurring series this occurrence belongs to, built from stable keys
   * so it survives re-scrapes.
   */
  seriesKey: string;
  /** Groups the series of one course (lecture, lab, …); equals `seriesKey` otherwise. */
  courseKey: string;
  attendance: AttendanceStatus | null;
  /** Original occurrence of a synced series whose sessions can share a displayed date. */
  attendanceOccurrence?: string;
  /** This mark predates occurrence keys and will be identified on the next attendance edit. */
  legacyAttendance?: boolean;
}

export function attendanceOccurrenceKey(event: CalEvent) {
  return event.attendanceOccurrence ?? event.originalDate ?? event.date;
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
  /** The position on the map is approximate, or the building itself is a guess. */
  approximate: boolean;
  /** No rule matched the room code: this is the student's own faculty building, as a guess. */
  guessed?: boolean;
}

export type Semester = typeof semesters.$inferSelect & { weeks: string[] };

function withTeachingWeeks(row: typeof semesters.$inferSelect): Semester {
  return { ...row, weeks: JSON.parse(row.teachingWeeks) as string[] };
}

export function currentSemester(): Semester | null {
  const row = getDb().select().from(semesters).where(eq(semesters.isCurrent, true)).get();
  return row ? withTeachingWeeks(row) : null;
}

/** 1-based teaching week, including its public days off. Whole-week breaks and sessions return null. */
export function teachingWeek(semester: Semester, date: string): number | null {
  const index = semester.weeks.indexOf(mondayOf(date));
  return index === -1 ? null : index + 1;
}

/* ───────────────────────────── Places ───────────────────────────── */

/** The buildings table's entry for each building of the campus tour's room catalogue. */
const SITE_BUILDING: Record<string, string> = {
  electro: "ELECTRO", chimie: "CHIM", mecanica: "MEC", orologerie: "MEC", spm: "SPM", imf: "SPM",
  aspc: "ASPC", remus: "MPT", hidro: "HIDRO", constructii: "CT",
};

export function placeResolver(facultyId: number | null) {
  const db = getDb();
  const rules = db.select().from(buildings).orderBy(asc(buildings.priority)).all();
  const byCode = new Map(rules.map((b) => [b.code, b]));
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
    if (!room?.trim()) return null;
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
    // The room catalogue behind the campus walkthroughs knows where many rooms are. A code it
    // has in one building only is placed there, so the calendar and the walkthrough agree
    // (a Mecanică class in C301B is in Electro, not "probably Mecanică").
    const site = campusRoomSite(room);
    const known = site ? byCode.get(SITE_BUILDING[site] ?? "") : undefined;
    if (known) {
      return { name: known.name, address: known.address, lat: known.lat, lng: known.lng, approximate: /approx/i.test(known.notes ?? "") };
    }
    // An unrecognised room is most likely in the student's own faculty building.
    if (faculty?.lat != null && faculty.lng != null) {
      return { name: faculty.name, address: faculty.address, lat: faculty.lat, lng: faculty.lng, approximate: true, guessed: true };
    }
    return null;
  };
}

/**
 * The place behind a building name a link carries (`/campus?building=…`): a building of the
 * table, or the student's own faculty building, which is how a guess is named.
 */
export function placeByName(name: string, facultyId: number | null): Place | null {
  const db = getDb();
  const building = db.select().from(buildings).where(eq(buildings.name, name)).orderBy(asc(buildings.priority)).get();
  if (building && building.code !== "ONLINE") {
    return { name: building.name, address: building.address, lat: building.lat, lng: building.lng, approximate: /approx/i.test(building.notes ?? "") };
  }
  const faculty = facultyId ? db.select().from(faculties).where(eq(faculties.id, facultyId)).get() : undefined;
  if (faculty && faculty.name === name && faculty.lat != null && faculty.lng != null) {
    return { name: faculty.name, address: faculty.address, lat: faculty.lat, lng: faculty.lng, approximate: true, guessed: true };
  }
  return null;
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
  /**
   * The student's group already has this kind of class at a fixed time, and the slots are
   * sessions held besides it ("PC (l) - grupe suplimentare"): nothing is missing from the
   * timetable while none is picked.
   */
  slotsAreExtra: boolean;
}

/** A course with alternative slots and none picked, whose class is therefore not in the timetable. */
export function needsSlot(c: CourseChoice): boolean {
  return c.enrolled && c.slots.length > 0 && !c.chosenSlotId && !c.slotsAreExtra;
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
        slotsAreExtra: false,
      };
      byCourse.set(course.id, c);
    }
    if (entry.isSlotOption) {
      c.slots.push({ entryId: entry.id, kind: entry.kind, day: entry.day, startMin: entry.startMin, endMin: entry.endMin, room: entry.room });
    } else c.fixedCount++;
  }
  const fixedKinds = new Map<number, Set<EntryKind>>();
  for (const { entry, course } of rows) {
    if (!entry.isSlotOption) fixedKinds.set(course.id, (fixedKinds.get(course.id) ?? new Set()).add(entry.kind));
  }
  for (const c of byCourse.values()) {
    c.slotsAreExtra = c.slots.length > 0 && c.slots.every((s) => fixedKinds.get(c.courseId)?.has(s.kind));
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

/** The published timetable shared by a group. Lookups can also include its electives and alternative lab slots. */
export function groupWeek(groupId: number, semester: Semester, { includeOptions = false } = {}): WeekEntry[] {
  return loadGroup(groupId, semester.id)
    .rows.filter(({ entry, course }) => includeOptions || (!entry.isSlotOption && !entry.publishedOptional && !course.isOptional))
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

/**
 * Expands the student's effective schedule into dated events. `locale` is the language
 * of the short notes on each event ("odd weeks", "moved by you"); data for the assistant
 * model stays in English.
 */
function originalEvents(
  user: Pick<User, "id" | "facultyId" | "specializationId" | "year" | "groupId">,
  from: string,
  to: string,
  locale: Locale = "en",
): CalEvent[] {
  const t = common[locale].time;
  const place = placeResolver(user.facultyId);
  const events: CalEvent[] = [];
  const once = occurrenceMoves(user.id);
  const movedHere = [...once.values()].filter((o) => o.newDate >= from && o.newDate <= to && !isPublicHoliday(o.newDate));

  // Every term the range touches, up to the end of its exam session (dated meetings can fall there).
  const terms = user.groupId ? getDb().select().from(semesters).all().map(withTeachingWeeks) : [];
  for (const semester of terms) {
    const termEnd = semester.examEnd && semester.examEnd > semester.endDate ? semester.examEnd : semester.endDate;
    const first = from > semester.startDate ? from : semester.startDate;
    const last = to < termEnd ? to : termEnd;
    if (first > last && !movedHere.some((o) => o.date >= semester.startDate && o.date <= termEnd)) continue;
    const week = studentWeek(user, semester);
    for (let date = first; date <= last; date = addDays(date, 1)) {
      if (isPublicHoliday(date)) continue;
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
          note: [describeWeeks(e.weeks, locale), e.endMin === e.startMin ? t.endTimeUnpublished : null,
            e.moved ? t.movedByYou : null, e.note].filter(Boolean).join(" · ") || null,
          place: place(e.room),
          entryId: e.entryId,
          recurring: semester.isCurrent && !isDatedMeeting(e.weeks),
          courseId: e.courseId,
          moved: e.moved,
          seriesKey: `e:${e.entryKey}`,
          courseKey: `c:${e.courseKey}`,
          attendance: null,
        });
      }
    }
    const byEntry = new Map(week.map((e) => [e.entryId, e]));
    for (const o of movedHere) {
      const e = byEntry.get(o.entryId);
      if (!e) continue;
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
        note: t.movedOnce(`${dayName(weekday(o.date), locale, "short")} ${o.date} ${formatMinutes(e.startMin)}`),
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
      note: [examAudience(x.audience, locale), x.endMin === x.startMin ? t.endTimeUnpublished : null].filter(Boolean).join(" · ") || null,
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
    const timing = p.calendarTiming;
    const interval = timing ? editorInterval(timing) : undefined;
    const slices = timing ? calendarSlices(timing, from, to) : dates.map(date => ({ date, startMin: p.startMin, endMin: p.endMin, allDay: false, occurrence: undefined }));
    for (const { date, startMin, endMin, allDay, occurrence } of slices) {
      events.push({
        id: occurrence ? `p:${p.id}:${date}:${occurrence}` : `p:${p.id}:${date}`,
        type: "personal",
        kind: "personal",
        title: p.title,
        abbr: null,
        date,
        startMin, endMin, allDay, occurrence,
        attendanceOccurrence: timing?.recurrence?.length ? occurrence : undefined,
        personalEditor: { title: p.title, location: p.location ?? "", weekly: !!p.day || !!timing?.recurrence?.length, pattern: !!timing?.recurrence?.length, interval },
        room: p.location,
        teacher: null,
        note: p.description || (p.day ? t.everyWeek : null),
        place: null,
        personalId: p.id,
        recurring: !!p.day || !!timing?.recurrence?.length,
        seriesKey: `p:${p.id}`,
        courseKey: `p:${p.id}`,
        attendance: null,
      });
    }
  }

  for (const e of sharedEventsFor(user.id, from, to)) {
    events.push({
      id: `g:${e.id}`, groupEventId: e.id, campusRoom: campusRoomCode(e.location), type: "shared", kind: "shared", title: e.title,
      date: e.date, startMin: e.startMin, endMin: e.endMin, room: e.location,
      abbr: null, teacher: null, note: null, place: null,
      seriesKey: `g:${e.id}`, courseKey: `g:${e.id}`, attendance: null,
    });
  }

  return events;
}

export function eventsBetween(
  user: Pick<User, "id" | "facultyId" | "specializationId" | "year" | "groupId">,
  from: string, to: string, locale: Locale = "en",
): CalEvent[] {
  const read = (first: string, last: string) => originalEvents(user, first, last, locale);
  const events = applyGoogleSchedule(user.id, from, to, read(from, to), read);
  const byDay = new Map<string, CalEvent[]>();
  for (const e of events) {
    e.title ||= calendarMessages[locale].personal.untitled;
    const key = `${e.seriesKey}|${e.date}`;
    const day = byDay.get(key);
    if (day) day.push(e);
    else byDay.set(key, [e]);
  }
  const marks = getDb().select({ seriesKey: attendance.seriesKey, date: attendance.date, status: attendance.status,
    occurrenceKey: attendance.occurrenceKey, startMin: attendance.startMin }).from(attendance)
    .where(and(eq(attendance.userId, user.id), gte(attendance.date, from), lte(attendance.date, to)))
    .orderBy(desc(attendance.occurrenceKey)).all(); // Match explicit keys before legacy rows.
  for (const mark of marks) {
    const day = byDay.get(`${mark.seriesKey}|${mark.date}`);
    if (!day) continue;
    const event = mark.occurrenceKey
      ? day.find(e => attendanceOccurrenceKey(e) === mark.occurrenceKey)
      : day.find(e => !e.attendance && e.startMin === mark.startMin) ?? day.find(e => !e.attendance);
    if (event) {
      event.attendance = mark.status;
      if (!mark.occurrenceKey) event.legacyAttendance = true;
    }
  }

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
    if (isPublicHoliday(date)) continue;
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

export function describeGroup(groupId: number | null, locale: Locale = "en") {
  if (!groupId) return null;
  const row = getDb()
    .select({ group: groups, spec: specializations, faculty: faculties })
    .from(groups)
    .innerJoin(specializations, eq(specializations.id, groups.specializationId))
    .innerJoin(faculties, eq(faculties.id, specializations.facultyId))
    .where(eq(groups.id, groupId))
    .get();
  if (!row) return null;
  const label = [row.group.series, row.group.name].filter(Boolean).join(" · ") || common[locale].time.wholeYear;
  return { ...row, label };
}

/** The asker's own programme and series, for `findGroups` to prefer. */
export function ownCohort(user: Pick<User, "specializationId" | "groupId">): { specializationId: number | null; series: string | null } {
  const group = user.groupId ? getDb().select({ series: groups.series }).from(groups).where(eq(groups.id, user.groupId)).get() : undefined;
  return { specializationId: user.specializationId, series: group?.series || null };
}

/** Finds groups by a loose text query ("TI 3.2", "calculatoare anul 3 grupa 1.1"). */
export function findGroups(
  query: string,
  facultyId: number | null,
  preferYear: number | null = null,
  limit = 8,
  /** The asker's own programme and series: "2.1" then means the 2.1 next door, not another programme's. */
  prefer: { specializationId?: number | null; series?: string | null } = {},
) {
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
      // Smaller nudges than the year's, so they only order groups that match the text equally well.
      if (score > 0 && prefer.specializationId && r.spec.id === prefer.specializationId) score += 0.2;
      if (score > 0 && prefer.series && r.group.series === prefer.series) score += 0.1;
      return { ...r, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit);
}


/** Individual hidden classes offered for restoration in Settings and by Poli. */
export function hiddenClasses(userId: string, semesterId?: number) {
  if (!semesterId) return [];
  const db = getDb();
  const hidden = db
    .select({ id: entries.id, name: courses.name, kind: entries.kind, day: entries.day, time: entries.startMin,
      movedDay: userOverrides.day, movedTime: userOverrides.startMin })
    .from(userOverrides)
    .innerJoin(entries, eq(entries.id, userOverrides.entryId))
    .innerJoin(courses, eq(courses.id, entries.courseId))
    .where(and(eq(userOverrides.userId, userId), eq(userOverrides.hidden, true), eq(entries.semesterId, semesterId)))
    .orderBy(entries.day, entries.startMin).all();
  const ids = googleHiddenClasses(userId).filter(id => !hidden.some(e => e.id === id));
  if (ids.length) {
    const remote = db.select({ id: entries.id, name: courses.name, kind: entries.kind, day: entries.day, time: entries.startMin })
      .from(entries).innerJoin(courses, eq(courses.id, entries.courseId))
      .where(and(eq(entries.semesterId, semesterId), inArray(entries.id, ids))).all();
    hidden.push(...remote.map(row => ({ ...row, movedDay: null, movedTime: null })));
  }
  return hidden;
}

export function unhideClass(userId: string, entryId: number) {
  const ownClass = and(eq(userOverrides.userId, userId), eq(userOverrides.entryId, entryId), eq(userOverrides.hidden, true));
  const restored = resetGoogleClass(userId, entryId, true);
  return getDb().update(userOverrides).set({ hidden: false, updatedAt: new Date().toISOString() }).where(ownClass).run().changes > 0 || restored;
}
