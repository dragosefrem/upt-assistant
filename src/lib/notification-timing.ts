import type { Locale } from "@/i18n/config";
import { countdown } from "./examTips";
import type { CalEvent } from "./schedule";
import { daysBetween, nowLocal } from "./time";

export const EVENT_NOTICE_MINUTES = 15;
const EXAM_MILESTONES = [30, 120, 1440, 7 * 1440];
const EVENT_MILESTONES = [EVENT_NOTICE_MINUTES];

export interface NotificationLink {
  id: string;
  title: string;
  detail: string;
  href: string;
  category: string;
  expiresAt: number | null;
}

export interface ScheduledNotice extends NotificationLink {
  kind: CalEvent["kind"];
  startsAt: number;
  expiresAt: number;
  date: string;
  tip?: string;
  directionsHref?: string;
  mapsUrl?: string;
}

export type Notice = NotificationLink | ScheduledNotice;

export function isScheduled(notice: Notice): notice is ScheduledNotice {
  return "startsAt" in notice;
}

function milestones(notice: ScheduledNotice) {
  return notice.kind === "exam" ? EXAM_MILESTONES : EVENT_MILESTONES;
}

function milestoneKey(notice: ScheduledNotice, minutes: number) {
  return `${notice.id}:${notice.startsAt}:${minutes}`;
}

/** History for an event belongs to this scheduled occurrence, including its earlier alerts. */
export function historyKeys(notice: Notice): string[] {
  return isScheduled(notice) ? milestones(notice).map((m) => milestoneKey(notice, m)) : [notice.id];
}

/** Opening Poli late should deliver only the closest milestone already reached. */
export function alertKey(notice: Notice, now: number): string | null {
  if (notice.expiresAt !== null && now >= notice.expiresAt) return null;
  if (!isScheduled(notice)) return notice.id;
  const left = Math.ceil((notice.startsAt - now) / 60_000);
  if (left <= 0) return null;
  const reached = milestones(notice).find((minutes) => left <= minutes);
  return reached === undefined ? null : milestoneKey(notice, reached);
}

export function noticeCountdown(notice: ScheduledNotice, now: number, locale: Locale): string {
  const left = Math.ceil((notice.startsAt - now) / 60_000);
  const days = left <= 120 ? 0 : daysBetween(nowLocal(new Date(now)).date, notice.date);
  return countdown(days, left, locale);
}
