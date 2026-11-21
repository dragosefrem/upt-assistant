import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { attendance, courses, entries, exams, personalEvents, userOverrides, type AttendanceStatus } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { attendance as attendanceText } from "@/i18n/messages/attendance";
import { common } from "@/i18n/messages/common";
import type { User } from "./auth";
import { kindOrder } from "./kinds";
import { currentSemester, eventsBetween, placeResolver, studentWeek, type Place } from "./schedule";
import { describeWeeks, weekday } from "./time";

export type AttendanceRecord = typeof attendance.$inferSelect;

/** Only occurrences that have already come (today or earlier) can be marked. */
export function isMarkable(date: string, today: string): boolean {
  return date <= today;
}

export type MarkResult = { ok: true; status: AttendanceStatus | null } | { ok: false; status: number; error: string };

/**
 * Records (or with `status: null`, clears) whether the student attended one occurrence.
 *
 * The occurrence is looked up in the student's own calendar for that date, so only
 * real events can be marked and the stored title/time come from the server. `locale` is
 * the language of the error message.
 */
export function markAttendance(
  user: User,
  input: { eventId: string; date: string; status: AttendanceStatus | null },
  today: string,
  locale: Locale = "en",
): MarkResult {
  const t = attendanceText[locale].errors;
  if (!isMarkable(input.date, today)) return { ok: false, status: 400, error: t.notYet };
  const event = eventsBetween(user, input.date, input.date).find((e) => e.id === input.eventId && e.date === input.date);
  if (!event) return { ok: false, status: 404, error: t.notInCalendar };

  const db = getDb();
  const where = and(eq(attendance.userId, user.id), eq(attendance.seriesKey, event.seriesKey), eq(attendance.date, event.date));
  if (input.status === null) {
    db.delete(attendance).where(where).run();
    return { ok: true, status: null };
  }
  const values = {
    status: input.status,
    courseKey: event.courseKey,
    title: event.title,
    abbr: event.abbr,
    kind: event.kind,
    startMin: event.startMin,
    endMin: event.endMin,
    room: event.room,
    teacher: event.teacher,
  };
  db.insert(attendance)
    .values({ userId: user.id, seriesKey: event.seriesKey, date: event.date, ...values })
    .onConflictDoUpdate({
      target: [attendance.userId, attendance.seriesKey, attendance.date],
      set: { ...values, updatedAt: new Date().toISOString() },
    })
    .run();
  return { ok: true, status: input.status };
}

/** Every mark of a student, newest occurrence first. */
export function attendanceRecords(userId: string): AttendanceRecord[] {
  return getDb()
    .select()
    .from(attendance)
    .where(eq(attendance.userId, userId))
    .orderBy(desc(attendance.date), desc(attendance.startMin))
    .all();
}

/* ───────────────────────────── Summaries ───────────────────────────── */

export interface Tally {
  attended: number;
  missed: number;
  /** Whole-number percentage of marked occurrences attended; null when nothing is marked. */
  rate: number | null;
}

/**
 * One recurring event: the same course (or exam / personal event), type, weekday and
 * time. A class moved to another slot therefore starts a new series.
 */
export interface SeriesTally extends Tally {
  key: string;
  title: string;
  kind: string;
  /** 1 = Monday … 7 = Sunday */
  weekday: number;
  startMin: number;
  endMin: number;
  /** The marked occurrences, newest first. */
  records: AttendanceRecord[];
  /** Calendar series (timetable entries, exams, personal events) behind it, newest first. */
  seriesKeys: string[];
}

export interface AttendanceSummary extends Tally {
  series: SeriesTally[];
}

function tally(records: Pick<AttendanceRecord, "status">[]): Tally {
  const attended = records.filter((r) => r.status === "attended").length;
  const missed = records.length - attended;
  return { attended, missed, rate: records.length ? Math.round((attended / records.length) * 100) : null };
}

/** The series an occurrence belongs to: course, type, weekday and time. */
export function seriesOf(r: Pick<AttendanceRecord, "courseKey" | "kind" | "date" | "startMin" | "endMin">): string {
  return [r.courseKey, r.kind, weekday(r.date), r.startMin, r.endMin].join("|");
}

/**
 * Overall totals plus one tally per series. A series is named after its most recent
 * mark, so a renamed course shows its new name.
 */
export function summarizeAttendance(records: AttendanceRecord[]): AttendanceSummary {
  const latestFirst = [...records].sort((a, b) => b.date.localeCompare(a.date) || b.startMin - a.startMin);
  const groups = new Map<string, AttendanceRecord[]>();
  for (const r of latestFirst) {
    const key = seriesOf(r);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const series = [...groups].map(([key, list]): SeriesTally => {
    const head = list[0];
    return { key, title: head.title, kind: head.kind, weekday: weekday(head.date), startMin: head.startMin, endMin: head.endMin, records: list, seriesKeys: [...new Set(list.map((r) => r.seriesKey))], ...tally(list) };
  });
  series.sort(
    (a, b) =>
      a.title.localeCompare(b.title) ||
      kindOrder(a.kind) - kindOrder(b.kind) ||
      a.weekday - b.weekday ||
      a.startMin - b.startMin ||
      a.key.localeCompare(b.key),
  );
  return { ...tally(records), series };
}

/* ───────────────────────────── Details ───────────────────────────── */

/** What the event dialog shows about an event, for one series card. */
export interface SeriesDetails {
  /** "timetable": read from the current data; "saved": the event is gone, so from the marks. */
  source: "timetable" | "saved";
  title: string;
  abbr: string | null;
  kind: string;
  /** "Every week", "odd weeks", "weeks 1-7", "Once", … */
  weeks: string | null;
  room: string | null;
  place: Place | null;
  teacher: string | null;
  note: string | null;
  /** Exams only. */
  examDates: string[];
  audience: string | null;
}

type DetailFields = Omit<SeriesDetails, "source" | "place" | "examDates"> & { examDate: string | null };

/** Details of one calendar series from the current timetable, exams or personal events. */
function lookupSeries(user: User, seriesKey: string, week: ReturnType<typeof studentWeek>, locale: Locale): DetailFields | null {
  const t = attendanceText[locale].details;
  const db = getDb();
  const [type, ...rest] = seriesKey.split(":");
  const key = rest.join(":");
  const base = { examDate: null, audience: null };

  if (type === "e") {
    const current = week.find((w) => w.entryKey === key);
    if (current) {
      return {
        ...base,
        title: current.title,
        abbr: current.abbr,
        kind: current.kind,
        weeks: describeWeeks(current.weeks, locale) ?? t.everyWeek,
        room: current.room,
        teacher: current.teacher,
        note: [current.moved ? common[locale].time.movedByYou : null, current.note].filter(Boolean).join(" · ") || null,
      };
    }
    // Still imported but not on the student's timetable (hidden, or course unticked).
    const row = db.select({ entry: entries, course: courses }).from(entries).innerJoin(courses, eq(courses.id, entries.courseId)).where(eq(entries.key, key)).get();
    if (!row) return null;
    const hidden = db
      .select({ hidden: userOverrides.hidden })
      .from(userOverrides)
      .where(and(eq(userOverrides.userId, user.id), eq(userOverrides.entryId, row.entry.id)))
      .get()?.hidden;
    return {
      ...base,
      title: row.course.name,
      abbr: row.course.abbreviation,
      kind: row.entry.kind,
      weeks: describeWeeks(row.entry.weeks, locale) ?? t.everyWeek,
      room: row.entry.room,
      teacher: row.entry.teacher,
      note: hidden ? t.hidden : t.notOnTimetable,
    };
  }

  if (type === "x") {
    const x = db.select().from(exams).where(eq(exams.key, key)).get();
    if (!x) return null;
    return { title: x.courseName, abbr: x.courseAbbr, kind: "exam", weeks: t.once, room: x.room, teacher: x.teacher, note: null, examDate: x.date, audience: x.audience };
  }

  if (type === "p") {
    const p = db
      .select()
      .from(personalEvents)
      .where(and(eq(personalEvents.id, Number(key)), eq(personalEvents.userId, user.id)))
      .get();
    if (!p) return null;
    return { ...base, title: p.title, abbr: null, kind: "personal", weeks: p.date ? t.once : t.everyWeek, room: p.location, teacher: null, note: null };
  }
  return null;
}

/**
 * Details for every series card, keyed by `SeriesTally.key`. Current data wins; when
 * the event has left the timetable, the room/teacher saved with the marks are used.
 * A slot fed by several timetable entries (e.g. odd- and even-week rows) lists each
 * distinct value. `locale` is the language of the weeks and notes.
 */
export function seriesDetails(user: User, series: SeriesTally[], locale: Locale = "en"): Map<string, SeriesDetails> {
  const semester = currentSemester();
  const week = semester && user.groupId ? studentWeek(user, semester) : [];
  const place = placeResolver(user.facultyId);
  const cache = new Map<string, DetailFields | null>();
  const out = new Map<string, SeriesDetails>();

  for (const s of series) {
    const found = s.seriesKeys.map((k) => {
      if (!cache.has(k)) cache.set(k, lookupSeries(user, k, week, locale));
      return cache.get(k)!;
    });
    const parts: DetailFields[] = found.every((f) => f === null)
      ? s.seriesKeys.map((k) => {
          const r = s.records.find((x) => x.seriesKey === k)!;
          return {
            title: r.title,
            abbr: r.abbr,
            kind: r.kind,
            weeks: null,
            room: r.room,
            teacher: r.teacher,
            note: attendanceText[locale].details.gone,
            examDate: r.kind === "exam" ? r.date : null,
            audience: null,
          };
        })
      : found.filter((f): f is DetailFields => f !== null);

    const join = (pick: (p: DetailFields) => string | null) => [...new Set(parts.map(pick).filter((v): v is string => !!v))].join(" / ") || null;
    const room = join((p) => p.room);
    const firstRoom = parts.find((p) => p.room)?.room ?? null;
    out.set(s.key, {
      source: found.every((f) => f === null) ? "saved" : "timetable",
      title: parts[0].title,
      abbr: join((p) => p.abbr),
      kind: parts[0].kind,
      weeks: join((p) => p.weeks),
      room,
      // Like the calendar: personal events have no building; others fall back to the faculty.
      place: parts[0].kind === "personal" ? null : place(firstRoom),
      teacher: join((p) => p.teacher),
      note: join((p) => p.note),
      examDates: [...new Set(parts.map((p) => p.examDate).filter((d): d is string => !!d))],
      audience: join((p) => p.audience),
    });
  }
  return out;
}
