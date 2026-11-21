import "server-only";
import type { Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import type { User } from "./auth";
import { campusJourneyHref } from "./campuspath/links";
import { contactList } from "./contacts";
import { everydayTip, examTips } from "./examTips";
import { myGroupEvents } from "./group-events";
import { kindLabel } from "./kinds";
import type { NotificationLink, ScheduledNotice } from "./notification-timing";
import { REMINDER_DAYS } from "./reminders";
import { eventsBetween, type CalEvent } from "./schedule";
import { addDays, capitalize, daysBetween, formatDate, formatMinutes, localInstant, nowLocal } from "./time";

function dateAndTime(date: string, minutes: number, locale: Locale) {
  return `${capitalize(formatDate(date, { weekday: "short", day: "numeric", month: "short" }, locale))} · ${formatMinutes(minutes)}`;
}

function scheduledNotice(event: CalEvent, today: string, now: number, locale: Locale): ScheduledNotice | null {
  const startTime = formatMinutes(event.startMin);
  const startsAt = localInstant(`${event.date}T${startTime}`);
  if (startsAt === null) return null;
  const exam = event.type === "exam";
  // Exams stay on the list while in progress. A start-only entry expires when it starts.
  let expiresAt = startsAt;
  if (exam && event.endMin > event.startMin) {
    const end = event.endMin === 1440 ? `${addDays(event.date, 1)}T00:00` : `${event.date}T${formatMinutes(event.endMin)}`;
    expiresAt = localInstant(end) ?? startsAt;
  }
  if (expiresAt <= now) return null;

  const t = messages[locale].exams.card;
  const academic = event.type === "class" || exam;
  const location = academic ? (event.room ? t.room(event.room) : t.roomUnknown) : event.room;
  const destination = event.campusRoom ?? (event.place ? event.room : null);
  const href = exam ? `/exams#exam-${event.examId}`
    : event.groupEventId ? `/contacts/events/${event.groupEventId}`
    : `/?${new URLSearchParams({ date: event.date, event: event.id })}`;
  return {
    id: `${event.seriesKey}:${event.originalDate ?? event.date}`,
    kind: event.kind, category: kindLabel(event.kind, locale), title: event.title,
    date: event.date, startsAt, expiresAt, href,
    detail: [dateAndTime(event.date, event.startMin, locale), location, event.place?.name].filter(Boolean).join(" · "),
    directionsHref: destination ? campusJourneyHref({ to: destination, building: event.place?.name, course: event.title, date: event.date, at: startTime }) : undefined,
    mapsUrl: event.place ? `https://www.google.com/maps/search/?api=1&query=${event.place.lat},${event.place.lng}` : undefined,
    tip: exam ? examTips({ course: event.title, room: event.room, building: event.place?.name ?? null,
      startTime, daysLeft: daysBetween(today, event.date), minutesUntil: Math.ceil((startsAt - now) / 60_000) }, locale)[0] : undefined,
  };
}

export function studentNotifications(user: User, locale: Locale) {
  const at = new Date();
  const now = at.getTime();
  const { date: today } = nowLocal(at);
  const tomorrow = addDays(today, 1);
  const t = messages[locale].notifications;
  const upcoming: ScheduledNotice[] = [];
  for (const event of eventsBetween(user, today, addDays(today, REMINDER_DAYS), locale)) {
    if (event.type !== "exam" && event.date > tomorrow) continue;
    const notice = scheduledNotice(event, today, now, locale);
    if (notice) upcoming.push(notice);
  }

  const requests: NotificationLink[] = contactList(user.id)
    .filter((person) => !person.accepted && person.requestedBy !== user.id)
    .map((person) => ({
      id: `contact:${person.id}`, category: t.contact, title: t.contactFrom(person.name),
      detail: t.review, href: "/contacts#inbox", expiresAt: null,
    }));
  for (const event of myGroupEvents(user.id)) {
    if (event.response !== "pending" || event.status === "expired" || event.date < today) continue;
    const start = localInstant(`${event.date}T${formatMinutes(event.startMin)}`);
    if (start === null || start <= now) continue;
    requests.push({
      id: `invitation:${event.id}`, category: t.invitation, title: event.title,
      detail: `${t.invitedBy(event.host)} · ${dateAndTime(event.date, event.startMin, locale)}`,
      href: `/contacts/events/${event.id}`, expiresAt: event.status === "pending" ? Math.min(event.deadline, start) : start,
    });
  }
  return { userId: user.id, requests, upcoming, tip: everydayTip(today, locale) };
}

export type NotificationFeed = ReturnType<typeof studentNotifications>;
