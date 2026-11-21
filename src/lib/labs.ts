import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { entries, entryGroups, groups, specializations, type EntryKind } from "@/db/schema";
import type { User } from "./auth";
import {
  courseChoices,
  currentSemester,
  eventsBetween,
  overlaps,
  studentWeek,
  teachingWeek,
  type CalEvent,
  type Semester,
  type WeekEntry,
} from "./schedule";
import { addDays, isDatedMeeting, mondayOf, nowLocal, occursInWeek, weekday } from "./time";

/**
 * Answers the two questions first-year students get wrong from the grid:
 * "do I have lab this week?" (labs often run every other week, per semigroup) and
 * "I missed my lab, when do the other groups have it?".
 */

/** Activities held in small groups, which are the ones that alternate by week. */
export const PRACTICAL_KINDS: EntryKind[] = ["lab", "seminar", "project"];

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Whether a free-text course name or acronym means this timetable entry. */
export function courseMatches(e: Pick<WeekEntry, "title" | "abbr">, query: string): boolean {
  const q = fold(query);
  if (!q) return false;
  return [fold(e.title), fold(e.abbr ?? "")].some((n) => n && (n === q || n.includes(q) || (q.length > 3 && q.includes(n) && n.length > 2)));
}

export interface WeekInfo {
  monday: string;
  sunday: string;
  /** 1-based teaching week, or null in a holiday, before the semester or in the exam session. */
  week: number | null;
  parity: "odd" | "even" | null;
  /** Why there is no teaching: null when there is. */
  pause: "before-semester" | "holiday" | "session" | "after-semester" | "no-semester" | null;
  /** The next Monday on which teaching resumes, when this week has none. */
  resumes: string | null;
}

/** Where a date's week stands in the semester: its teaching-week number and parity. */
export function weekInfo(date: string, semester: Semester | null = currentSemester()): WeekInfo {
  const monday = mondayOf(date);
  const sunday = addDays(monday, 6);
  if (!semester) return { monday, sunday, week: null, parity: null, pause: "no-semester", resumes: null };
  const week = teachingWeek(semester, date);
  if (week !== null) return { monday, sunday, week, parity: week % 2 === 1 ? "odd" : "even", pause: null, resumes: null };
  const resumes = semester.weeks.find((w) => w > monday) ?? null;
  const pause =
    monday < semester.weeks[0]
      ? "before-semester"
      : resumes
        ? "holiday"
        : semester.examStart && semester.examEnd && sunday >= semester.examStart && monday <= semester.examEnd
          ? "session"
          : "after-semester";
  return { monday, sunday, week: null, parity: null, pause, resumes };
}

export interface SkippedActivity {
  entryId: number;
  title: string;
  abbr: string | null;
  kind: EntryKind;
  /** 1 = Monday … 7 = Sunday */
  day: number;
  startMin: number;
  endMin: number;
  room: string | null;
  /** The week rule as stored: "odd", "even", "1-7", "odd&1-7", … */
  weeks: string;
  /** The next date it does take place on, or null if it has finished for the semester. */
  next: string | null;
}

export interface PracticalWeek extends WeekInfo {
  /** Labs, seminars and projects that take place in this week, in calendar order. */
  running: CalEvent[];
  /** Ones in the student's timetable that do not take place this week. */
  skipped: SkippedActivity[];
  /** Courses whose lab runs in several slots and the student has not chosen one, so it is missing above. */
  unchosen: Array<{ courseId: number; name: string; abbr: string | null }>;
}

/** The next date on or after `from` on which a weekly entry takes place, within the semester. */
export function nextOccurrence(e: Pick<WeekEntry, "day" | "weeks">, semester: Semester, from: string): string | null {
  if (isDatedMeeting(e.weeks)) {
    const date = addDays(mondayOf(e.weeks), e.day - 1);
    return date >= from ? date : null;
  }
  for (const [i, monday] of semester.weeks.entries()) {
    const date = addDays(monday, e.day - 1);
    if (date >= from && date <= semester.endDate && occursInWeek(e.weeks, i + 1, monday)) return date;
  }
  return null;
}

/**
 * The student's labs, seminars and projects for the week containing `date`: which take
 * place, which do not (and when they next do), and which are missing because no slot
 * was chosen. Personal changes (hidden, moved, moved for one week) are respected.
 */
export function practicalsInWeek(
  user: Pick<User, "id" | "facultyId" | "specializationId" | "year" | "groupId">,
  date: string,
  kinds: EntryKind[] = PRACTICAL_KINDS,
): PracticalWeek {
  const semester = currentSemester();
  const info = weekInfo(date, semester);
  const wanted = new Set<string>(kinds);
  if (!semester || !user.groupId) return { ...info, running: [], skipped: [], unchosen: [] };

  const running = eventsBetween(user, info.monday, info.sunday).filter((e) => e.type === "class" && wanted.has(e.kind));
  const runningIds = new Set(running.map((e) => e.entryId));
  const today = nowLocal().date;
  const after = info.sunday >= today ? addDays(info.sunday, 1) : today;
  const skipped = studentWeek(user, semester)
    .filter((e) => wanted.has(e.kind) && !runningIds.has(e.entryId))
    .map((e) => ({
      entryId: e.entryId,
      title: e.title,
      abbr: e.abbr,
      kind: e.kind,
      day: e.day,
      startMin: e.startMin,
      endMin: e.endMin,
      room: e.room,
      weeks: e.weeks,
      next: nextOccurrence(e, semester, after),
    }));
  const unchosen = courseChoices(user, semester)
    .filter((c) => c.enrolled && c.slots.length > 0 && !c.chosenSlotId && c.slots.some((s) => wanted.has(s.kind)))
    .map((c) => ({ courseId: c.courseId, name: c.name, abbr: c.abbr }));
  return { ...info, running, skipped, unchosen };
}

/* ───────────────────────────── Make-up sessions ───────────────────────────── */

export interface MakeupSession {
  entryId: number;
  date: string;
  startMin: number;
  endMin: number;
  room: string | null;
  teacher: string | null;
  /** Who normally attends, e.g. ["CTI · Seria 1 (C) · 1.2"]. */
  groups: string[];
  /** True when one of those groups is in the student's own specialization and year. */
  sameYear: boolean;
  /** The student's own events that overlap it; empty when it fits their timetable. */
  clashes: Array<{ title: string; kind: string; startMin: number; endMin: number }>;
}

export interface MakeupResult {
  /** The student's own activity that was matched. */
  course: string;
  abbr: string | null;
  kind: EntryKind;
  /** When the student's own group has it in the period, for reference. */
  own: Array<{ date: string; startMin: number; endMin: number; room: string | null }>;
  /** Other groups' sessions of the same activity, ones that fit the timetable first, then by date. */
  sessions: MakeupSession[];
}

export type MakeupOutcome =
  | { ok: true; result: MakeupResult }
  | { ok: false; reason: "no-semester" | "no-group" | "not-found" }
  | { ok: false; reason: "ambiguous"; candidates: Array<{ title: string; abbr: string | null; kind: EntryKind }> };

/**
 * Sessions of the same lab (or seminar, project) that OTHER groups have between two
 * dates, for a student who missed their own. Only sessions that have not started yet
 * are returned. Whether the student may attend one is up to the teaching staff.
 */
export function makeupSessions(
  user: Pick<User, "id" | "facultyId" | "specializationId" | "year" | "groupId">,
  query: { course: string; kind?: EntryKind; from: string; to: string },
  limit = 12,
): MakeupOutcome {
  const semester = currentSemester();
  if (!semester) return { ok: false, reason: "no-semester" };
  if (!user.groupId) return { ok: false, reason: "no-group" };

  // Match against everything the group has, so a hidden or skipped lab can still be made up.
  const everything = studentWeek({ id: "", groupId: user.groupId, year: user.year }, semester);
  let mine = everything.filter((e) => courseMatches(e, query.course) && (query.kind ? e.kind === query.kind : PRACTICAL_KINDS.includes(e.kind)));
  if (!query.kind && mine.some((e) => e.kind === "lab")) mine = mine.filter((e) => e.kind === "lab");
  if (!mine.length) return { ok: false, reason: "not-found" };
  const distinct = new Map(mine.map((e) => [`${e.courseId}|${e.kind}`, e]));
  if (distinct.size > 1) {
    return { ok: false, reason: "ambiguous", candidates: [...distinct.values()].map((e) => ({ title: e.title, abbr: e.abbr, kind: e.kind })) };
  }
  const [{ courseId, kind, title, abbr }] = mine;
  const mineIds = new Set(mine.map((e) => e.entryId));

  const db = getDb();
  const others = db
    .select()
    .from(entries)
    .where(and(eq(entries.courseId, courseId), eq(entries.kind, kind), eq(entries.semesterId, semester.id)))
    .all()
    .filter((e) => !mineIds.has(e.id));
  const attendees = others.length
    ? db
        .select({ entryId: entryGroups.entryId, group: groups, spec: specializations })
        .from(entryGroups)
        .innerJoin(groups, eq(groups.id, entryGroups.groupId))
        .innerJoin(specializations, eq(specializations.id, groups.specializationId))
        .where(inArray(entryGroups.entryId, others.map((e) => e.id)))
        .all()
    : [];
  const byEntry = new Map<number, typeof attendees>();
  for (const a of attendees) byEntry.set(a.entryId, [...(byEntry.get(a.entryId) ?? []), a]);

  const now = nowLocal();
  const from = query.from < now.date ? now.date : query.from;
  const myEvents = query.to >= from ? eventsBetween(user, from, query.to) : [];
  const occursOn = (e: { day: number; weeks: string }, date: string) =>
    e.day === weekday(date) && occursInWeek(e.weeks, date >= semester.startDate && date <= semester.endDate ? teachingWeek(semester, date) : null, mondayOf(date));

  const sessions: MakeupSession[] = [];
  const own: MakeupResult["own"] = [];
  for (let date = from; date <= query.to; date = addDays(date, 1)) {
    for (const e of mine) if (occursOn(e, date)) own.push({ date, startMin: e.startMin, endMin: e.endMin, room: e.room });
    for (const e of others) {
      if (!occursOn(e, date)) continue;
      if (date === now.date && e.startMin <= now.minutes) continue;
      const who = byEntry.get(e.id) ?? [];
      // An entry shared by the student's own group is their own session listed twice (slot options).
      if (who.some((a) => a.group.id === user.groupId)) continue;
      sessions.push({
        entryId: e.id,
        date,
        startMin: e.startMin,
        endMin: e.endMin,
        room: e.room,
        teacher: e.teacher,
        groups: who.map((a) => [a.spec.code ?? a.spec.name, a.group.series, a.group.name].filter(Boolean).join(" · ")),
        sameYear: who.some((a) => a.spec.id === user.specializationId && a.group.year === user.year),
        clashes: myEvents
          .filter((m) => m.date === date && overlaps(m, e))
          .map((m) => ({ title: m.title, kind: m.kind, startMin: m.startMin, endMin: m.endMin })),
      });
    }
  }
  sessions.sort(
    (a, b) =>
      Number(a.clashes.length > 0) - Number(b.clashes.length > 0) ||
      a.date.localeCompare(b.date) ||
      a.startMin - b.startMin ||
      Number(b.sameYear) - Number(a.sameYear),
  );
  return { ok: true, result: { course: title, abbr, kind, own, sessions: sessions.slice(0, limit) } };
}
