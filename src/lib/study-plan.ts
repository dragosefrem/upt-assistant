import "server-only";
import { and, eq, like } from "drizzle-orm";
import { getDb } from "@/db";
import { personalEvents } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import { study } from "@/i18n/messages/study";
import type { User } from "./auth";
import { eventsBetween, examsForUser, freeSlots } from "./schedule";
import { addDays, nowLocal, weekday } from "./time";

/**
 * The exam study planner. It works backwards: starting from the last exam, each exam
 * takes the latest free time before it, so the days right before an exam belong to that
 * exam and earlier exams reach further back. Study blocks go only into time the
 * student's calendar leaves free, never on a day with an exam, and the block closest
 * to each exam is its final review.
 *
 * The pure part (`buildStudyPlan`) knows nothing about the database, so it is easy to test.
 */

export interface PlanExam {
  /** Stable id of the exam: `exams.key`, or "manual:…" for one the student told us about. */
  key: string;
  course: string;
  date: string;
  startMin: number;
  endMin: number;
  /** Later sittings of the same exam, which the plan does not target. */
  alsoOn?: string[];
}

export interface StudySession {
  examKey: string;
  course: string;
  date: string;
  startMin: number;
  endMin: number;
  /** 1-based position among this exam's blocks, in calendar order. */
  index: number;
  total: number;
  /** The last block before the exam. */
  review: boolean;
}

export interface StudyPlanOptions {
  today: string;
  nowMinutes: number;
  /** Length of one study block. Default 120. */
  sessionMinutes?: number;
  /** Blocks wanted per exam. Default 6 (twelve hours with the default length). */
  sessionsPerExam?: number;
  /** Most blocks on one day. Default 2. */
  maxPerDay?: number;
  /** Earliest start and latest end of a block. Default 10:00–20:00. */
  dayStart?: number;
  dayEnd?: number;
  /** Weekdays kept free of study (1 = Monday … 7 = Sunday). Default Sunday. */
  restWeekdays?: number[];
  /** Nothing is planned before this date. Default today. */
  startFrom?: string;
}

export interface StudyPlan {
  sessions: StudySession[];
  /** Exams that did not get all the blocks asked for, with how many they got. */
  short: Array<{ examKey: string; course: string; planned: number; wanted: number }>;
}

type Busy = { date: string; startMin: number; endMin: number };

/** Pause kept free around a study block: a meal or a walk between two blocks on one day. */
const BREAK_MIN = 90;

export function buildStudyPlan(exams: PlanExam[], busy: Busy[], options: StudyPlanOptions): StudyPlan {
  const {
    today,
    nowMinutes,
    sessionMinutes = 120,
    sessionsPerExam = 6,
    maxPerDay = 2,
    dayStart = 10 * 60,
    dayEnd = 20 * 60,
    restWeekdays = [7],
  } = options;
  const firstDay = options.startFrom && options.startFrom > today ? options.startFrom : today;
  const upcoming = exams.filter((x) => x.date > firstDay).sort((a, b) => b.date.localeCompare(a.date) || b.startMin - a.startMin);
  const examDays = new Set(exams.flatMap((x) => [x.date, ...(x.alsoOn ?? [])]));
  const rest = new Set(restWeekdays);

  const taken = new Map<string, Busy[]>();
  const planned = new Map<string, Busy[]>(upcoming.map((x) => [x.key, []]));

  for (const exam of upcoming) {
    const mine = planned.get(exam.key)!;
    for (let date = addDays(exam.date, -1); date >= firstDay && mine.length < sessionsPerExam; date = addDays(date, -1)) {
      if (examDays.has(date) || rest.has(weekday(date))) continue;
      const day = taken.get(date) ?? [];
      // Days are filled backwards from the exam; within a day the earliest free time goes first,
      // so a day with two blocks has one before lunch and one after.
      while (day.length < maxPerDay && mine.length < sessionsPerExam) {
        const occupied = [
          ...busy.filter((b) => b.date === date),
          ...day.map((s) => ({ date, startMin: s.startMin - BREAK_MIN, endMin: s.endMin + BREAK_MIN })),
        ];
        if (date === today) occupied.push({ date, startMin: 0, endMin: nowMinutes + 30 });
        const startMin = freeSlots(occupied, date, date, { dayStart, dayEnd, minMinutes: sessionMinutes, weekdaysOnly: false })
          .map((gap) => ({ gap, start: Math.ceil(gap.startMin / 30) * 30 }))
          .find(({ gap, start }) => start + sessionMinutes <= gap.endMin)?.start;
        if (startMin === undefined) break;
        const session = { date, startMin, endMin: startMin + sessionMinutes };
        day.push(session);
        mine.push(session);
        taken.set(date, day);
      }
    }
  }

  const sessions: StudySession[] = [];
  const short: StudyPlan["short"] = [];
  for (const exam of upcoming) {
    const mine = planned.get(exam.key)!.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
    if (mine.length < sessionsPerExam) short.push({ examKey: exam.key, course: exam.course, planned: mine.length, wanted: sessionsPerExam });
    mine.forEach((s, i) =>
      sessions.push({ examKey: exam.key, course: exam.course, ...s, index: i + 1, total: mine.length, review: i === mine.length - 1 && mine.length > 1 }),
    );
  }
  sessions.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
  return { sessions, short };
}

/* ───────────────────────────── For a student ───────────────────────────── */

const PLAN_PREFIX = "study:";

export interface StudyRequest {
  /** Hours of study wanted per exam. Default 12. */
  hoursPerExam?: number;
  sessionMinutes?: number;
  maxPerDay?: number;
  dayStart?: number;
  dayEnd?: number;
  /** Keep Sunday free. Default true. */
  restOnSunday?: boolean;
  /** Explicit rest days override the Sunday preference. */
  restWeekdays?: number[];
  startFrom?: string;
  /** Exams the faculty has not published yet, as the student gave them. */
  extraExams?: Array<{ course: string; date: string; startMin?: number }>;
}

export interface StudentStudyPlan extends StudyPlan {
  exams: PlanExam[];
  sessionMinutes: number;
}

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The student's upcoming exams: the published ones plus any they named themselves.
 *
 * Faculties publish each exam in two sittings a couple of weeks apart (and sometimes in
 * several shifts on one day). The plan prepares for the first sitting of each course;
 * the later ones are kept as `alsoOn` so the student knows about them.
 */
export function upcomingExams(user: User, extra: StudyRequest["extraExams"] = [], today = nowLocal().date): PlanExam[] {
  const byCourse = new Map<string, PlanExam>();
  for (const x of examsForUser(user, today)) {
    const id = slug(x.courseName);
    const first = byCourse.get(id);
    if (!first) {
      byCourse.set(id, { key: x.key, course: x.courseName, date: x.date, startMin: x.startMin, endMin: x.endMin > x.startMin ? x.endMin : x.startMin + 120, alsoOn: [] });
    } else if (x.date !== first.date && !first.alsoOn!.includes(x.date)) {
      first.alsoOn!.push(x.date);
    } else if (x.date === first.date) {
      // Several shifts on the day: keep the whole span busy, since the student's shift is not known.
      first.endMin = Math.max(first.endMin, x.endMin > x.startMin ? x.endMin : x.startMin + 120);
    }
  }
  const published = [...byCourse.values()];
  const manual: PlanExam[] = extra
    .filter((x) => x.course.trim() && /^\d{4}-\d{2}-\d{2}$/.test(x.date) && x.date >= today && !byCourse.has(slug(x.course)))
    .map((x) => {
      const startMin = x.startMin ?? 9 * 60;
      return { key: `manual:${slug(x.course)}-${x.date}`, course: x.course.trim().slice(0, 100), date: x.date, startMin, endMin: startMin + 120 };
    });
  return [...published, ...manual].sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin);
}

/** Proposes a plan around the student's current calendar. Nothing is saved. */
export function proposeStudyPlan(user: User, request: StudyRequest = {}): StudentStudyPlan {
  const now = nowLocal();
  const exams = upcomingExams(user, request.extraExams, now.date);
  const sessionMinutes = Math.min(Math.max(Math.round(request.sessionMinutes ?? 120), 30), 240);
  const hours = Math.min(Math.max(request.hoursPerExam ?? 12, 1), 60);
  if (!exams.length) return { exams, sessions: [], short: [], sessionMinutes };
  const last = exams.at(-1)!.date;
  // Existing study blocks are about to be replaced, so they do not count as busy.
  const existing = new Set(studyBlocks(user.id).map((p) => p.id));
  const busy: Busy[] = [
    ...eventsBetween(user, now.date, last).filter((e) => !(e.personalId != null && existing.has(e.personalId))),
    // An exam the student named is not in the calendar yet, but it still takes the time.
    ...exams.filter((x) => x.key.startsWith("manual:")),
  ];
  const plan = buildStudyPlan(exams, busy, {
    today: now.date,
    nowMinutes: now.minutes,
    sessionMinutes,
    sessionsPerExam: Math.max(1, Math.round((hours * 60) / sessionMinutes)),
    maxPerDay: Math.min(Math.max(Math.round(request.maxPerDay ?? 2), 1), 4),
    dayStart: request.dayStart,
    dayEnd: request.dayEnd,
    restWeekdays: request.restWeekdays ?? (request.restOnSunday === false ? [] : [7]),
    startFrom: request.startFrom,
  });
  return { exams, sessionMinutes, ...plan };
}

/** The study blocks currently in the student's calendar. */
export function studyBlocks(userId: string) {
  return getDb()
    .select()
    .from(personalEvents)
    .where(and(eq(personalEvents.userId, userId), like(personalEvents.plan, `${PLAN_PREFIX}%`)))
    .all();
}

/** Replaces the student's study blocks with `sessions`, titled in their language. */
export function saveStudyPlan(userId: string, sessions: StudySession[], locale: Locale): number {
  const t = study[locale].plan;
  return getDb().transaction((tx) => {
    tx.delete(personalEvents).where(and(eq(personalEvents.userId, userId), like(personalEvents.plan, `${PLAN_PREFIX}%`))).run();
    if (!sessions.length) return 0;
    tx.insert(personalEvents)
      .values(
        sessions.map((s) => ({
          userId,
          title: (s.review ? t.reviewTitle(s.course) : t.sessionTitle(s.course, s.index, s.total)).slice(0, 120),
          date: s.date,
          day: null,
          startMin: s.startMin,
          endMin: s.endMin,
          location: null,
          plan: `${PLAN_PREFIX}${s.examKey}`,
        })),
      )
      .run();
    return sessions.length;
  });
}

/** Removes every study block; returns how many there were. */
export function clearStudyPlan(userId: string): number {
  const where = and(eq(personalEvents.userId, userId), like(personalEvents.plan, `${PLAN_PREFIX}%`));
  const db = getDb();
  const n = db.select({ id: personalEvents.id }).from(personalEvents).where(where).all().length;
  if (n) db.delete(personalEvents).where(where).run();
  return n;
}
