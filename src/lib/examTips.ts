/**
 * Friendly, practical suggestions from Poli for an upcoming exam. Pure functions, so
 * the same wording is used on the home page, the exams page and in notifications.
 */

import type { Locale } from "@/i18n/config";
import { exams } from "@/i18n/messages/exams";

export type ExamStage = "later" | "week" | "soon" | "tomorrow" | "today" | "now";

/** How close an exam is, from the whole days left and the minutes until it starts. */
export function examStage(daysLeft: number, minutesUntil: number): ExamStage {
  if (minutesUntil <= 0) return "now";
  if (daysLeft <= 0) return "today";
  if (daysLeft === 1) return "tomorrow";
  if (daysLeft <= 3) return "soon";
  if (daysLeft <= 7) return "week";
  return "later";
}

/** "in 3 days", "tomorrow", "in 2 h 15 min", "now". */
export function countdown(daysLeft: number, minutesUntil: number, locale: Locale = "en"): string {
  const t = exams[locale].countdown;
  if (minutesUntil <= 0) return t.now;
  if (daysLeft <= 0) {
    if (minutesUntil < 60) return t.inMinutes(minutesUntil);
    return t.inHours(Math.floor(minutesUntil / 60), minutesUntil % 60);
  }
  if (daysLeft === 1) return t.tomorrow;
  return t.inDays(daysLeft);
}

export interface TipInput {
  course: string;
  daysLeft: number;
  minutesUntil: number;
  startTime: string;
  room: string | null;
  building: string | null;
  /** Minutes the trip takes from the student's position, when known. */
  travelMinutes?: number | null;
}

/** Where to go, in one short phrase: "room A101 (Mechanical Engineering building)". */
export function whereTo(room: string | null, building: string | null, locale: Locale = "en"): string {
  const t = exams[locale].where;
  if (room && building) return t.roomIn(room, building);
  if (room) return t.room(room);
  if (building) return building;
  return t.unknown;
}

/** The headline Poli says for an exam at this stage. */
export function examHeadline({ course, daysLeft, minutesUntil, startTime, room, building }: TipInput, locale: Locale = "en"): string {
  const t = exams[locale].headline;
  const where = whereTo(room, building, locale);
  switch (examStage(daysLeft, minutesUntil)) {
    case "now":
      return t.now(course, where);
    case "today":
      return t.today(course, startTime, where);
    case "tomorrow":
      return t.tomorrow(course, startTime, where);
    case "soon":
      return t.soon(course, daysLeft, where);
    case "week":
      return t.week(course, daysLeft);
    default:
      return t.later(course, daysLeft);
  }
}

/** Two or three concrete suggestions that fit how close the exam is. */
export function examTips(input: TipInput, locale: Locale = "en"): string[] {
  const t = exams[locale].tips;
  const { daysLeft, minutesUntil, startTime, room, building, travelMinutes } = input;
  const where = whereTo(room, building, locale);
  switch (examStage(daysLeft, minutesUntil)) {
    case "now":
      return [t.now];
    case "today": {
      const [h, m] = startTime.split(":").map(Number);
      const arrive = h * 60 + m - 15;
      const by = arrive >= 0 ? `${String(Math.floor(arrive / 60)).padStart(2, "0")}:${String(arrive % 60).padStart(2, "0")}` : startTime;
      const leave = travelMinutes ? t.leave(travelMinutes + 15, startTime, where) : t.beThere(where, by);
      return [leave, t.pack, t.eat];
    }
    case "tomorrow":
      return [t.review, t.route(where), t.sleep];
    case "soon":
      return [t.pastExam, t.ask, t.blocks];
    case "week":
      return [t.split, t.summary, t.group];
    default:
      return [t.plan, t.steady];
  }
}

/** Gentle tips for days without exams coming up, in English. One is picked by the day of the year. */
export const EVERYDAY_TIPS = exams.en.everyday;

export function everydayTip(date: string, locale: Locale = "en"): string {
  const tips = exams[locale].everyday;
  const day = Math.floor(Date.parse(`${date}T00:00:00Z`) / 86_400_000);
  return tips[((day % tips.length) + tips.length) % tips.length];
}
