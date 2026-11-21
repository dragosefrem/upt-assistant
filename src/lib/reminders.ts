import "server-only";
import type { User } from "./auth";
import { countdown, examHeadline, examStage, examTips, type ExamStage } from "./examTips";
import { examsForUser, placeResolver, type Place } from "./schedule";
import { addDays, daysBetween, formatMinutes, nowLocal } from "./time";

/** How far ahead exam reminders look. */
export const REMINDER_DAYS = 30;

export interface ExamReminder {
  /** Stable per exam; notifications add the stage to it so each stage fires once. */
  id: string;
  examId: number;
  course: string;
  teacher: string | null;
  date: string;
  startMin: number;
  endMin: number;
  room: string | null;
  place: Place | null;
  /** Google Maps link to the building, when it is known. */
  mapsUrl: string | null;
  daysLeft: number;
  /** Minutes from now until the exam starts (negative once it has begun). */
  minutesUntil: number;
  stage: ExamStage;
  countdown: string;
  headline: string;
  tips: string[];
}

/** Upcoming exams of the student, nearest first, with where to go and Poli's suggestions. */
export function examReminders(user: User, at: Date = new Date()): ExamReminder[] {
  const now = nowLocal(at);
  const place = placeResolver(user.facultyId);
  return examsForUser(user, now.date, addDays(now.date, REMINDER_DAYS))
    .map((x) => {
      const daysLeft = daysBetween(now.date, x.date);
      const minutesUntil = daysLeft * 1440 + x.startMin - now.minutes;
      return { x, daysLeft, minutesUntil };
    })
    // Keep an exam until it is over.
    .filter(({ x, daysLeft }) => daysLeft > 0 || x.endMin > now.minutes)
    .map(({ x, daysLeft, minutesUntil }) => {
      const p = place(x.room);
      const tipInput = {
        course: x.courseName,
        daysLeft,
        minutesUntil,
        startTime: formatMinutes(x.startMin),
        room: x.room,
        building: p?.name ?? null,
      };
      return {
        id: `exam-${x.id}`,
        examId: x.id,
        course: x.courseName,
        teacher: x.teacher,
        date: x.date,
        startMin: x.startMin,
        endMin: x.endMin,
        room: x.room,
        place: p,
        mapsUrl: p ? `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}` : null,
        daysLeft,
        minutesUntil,
        stage: examStage(daysLeft, minutesUntil),
        countdown: countdown(daysLeft, minutesUntil),
        headline: examHeadline(tipInput),
        tips: examTips(tipInput),
      };
    });
}
