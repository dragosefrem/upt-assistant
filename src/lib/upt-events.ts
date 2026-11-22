import "server-only";
import { and, asc, eq, gte, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { uptEventOccurrences, uptEventSubscriptions } from "@/db/schema";
import { campusRoomCode } from "./campuspath/known-room";
import { tentativeTimesFor } from "./group-events";
import { eventsBetween, overlaps, type CalEvent, type FreeSlot } from "./schedule";

export function isUptSubscriber(userId: string) {
  return !!getDb().select().from(uptEventSubscriptions).where(eq(uptEventSubscriptions.userId, userId)).get();
}

export function setUptSubscription(userId: string, subscribed: boolean) {
  const db = getDb();
  if (subscribed) db.insert(uptEventSubscriptions).values({ userId }).onConflictDoNothing().run();
  else db.delete(uptEventSubscriptions).where(eq(uptEventSubscriptions.userId, userId)).run();
}

type CalendarOwner = Parameters<typeof eventsBetween>[0];

/** Source events are a calendar layer. They yield to bookings, including later edits and accepted invitations. */
export function matchingUptEvents(user: CalendarOwner, range?: { from: string; to: string; scheduled: CalEvent[] }): CalEvent[] {
  const table = uptEventOccurrences;
  const sessions = getDb().select().from(table)
    .where(range ? and(gte(table.date, range.from), lte(table.date, range.to)) : undefined)
    .orderBy(asc(table.date), asc(table.startMin), asc(table.endMin), asc(table.id)).all();
  if (!sessions.length) return [];
  const first = sessions[0].date;
  const last = sessions[sessions.length - 1].date;
  const busyByDay = new Map<string, FreeSlot[]>();
  for (const slot of [...(range?.scheduled ?? eventsBetween(user, first, last)), ...tentativeTimesFor(user.id, first, last)]) {
    const day = busyByDay.get(slot.date) ?? [];
    // A class/exam with no published finish cannot establish a free interval later that day.
    day.push(slot.endMin === slot.startMin ? { ...slot, endMin: 1440 } : slot);
    busyByDay.set(slot.date, day);
  }

  const result: CalEvent[] = [];
  for (const slot of sessions) {
    const day = busyByDay.get(slot.date) ?? [];
    if (day.some((b) => overlaps(slot, b))) continue;
    // For simultaneous university sessions, show the first fitting one consistently in every view.
    day.push(slot);
    busyByDay.set(slot.date, day);
    const id = `upt:${slot.id}`;
    result.push({ id, seriesKey: id, courseKey: id, type: "upt", kind: "upt", title: slot.title,
      date: slot.date, startMin: slot.startMin, endMin: slot.endMin, room: slot.location, note: slot.access,
      sourceUrl: slot.sourceUrl, campusRoom: campusRoomCode(slot.location), teacher: null, place: null, abbr: null, attendance: null });
  }
  return result;
}

export function withUptCalendar(user: CalendarOwner, from: string, to: string, scheduled: CalEvent[]) {
  const uptSubscribed = isUptSubscriber(user.id);
  if (!uptSubscribed) return { uptSubscribed, events: scheduled };
  const events = [...scheduled, ...matchingUptEvents(user, { from, to, scheduled })];
  events.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.endMin - b.endMin);
  return { uptSubscribed, events };
}
