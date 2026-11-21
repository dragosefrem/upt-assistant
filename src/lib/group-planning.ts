import "server-only";
import { randomBytes, randomUUID } from "node:crypto";
import { getDb } from "@/db";
import { eventParticipants, groupEvents } from "@/db/schema";
import type { User } from "./auth";
import { acceptedScheduleContacts, InvitationError } from "./contacts";
import { tentativeTimesFor } from "./group-events";
import { nextDays, PLANNING_PAGE_DAYS, type DateRange } from "./planning-range";
import { eventsBetween, freeSlots } from "./schedule";
import { daysBetween, formatMinutes, localInstant, nowLocal } from "./time";

/** Only the intersection of free intervals leaves the server. */
export function groupAvailability(user: User, contactIds: string[], range?: DateRange, asOf = nowLocal()) {
  const { date: today, minutes } = asOf;
  const { from, to } = range ?? nextDays(today, 7);
  const span = daysBetween(from, to);
  if (!Number.isInteger(span) || from < today || span < 0 || span >= PLANNING_PAGE_DAYS) {
    throw new InvitationError("Choose a valid page of upcoming dates.");
  }
  const ids = [...new Set(contactIds)];
  const others = acceptedScheduleContacts(user.id, ids);
  if (others.length !== ids.length) throw new InvitationError("Choose people from your accepted contacts.");
  const busy = [user, ...others].flatMap((person) => [
    ...eventsBetween(person, from, to),
    ...tentativeTimesFor(person.id, from, to),
  ]);
  if (from === today) busy.push({ date: today, startMin: 0, endMin: minutes + 1 });
  return freeSlots(busy, from, to, { dayStart: 0, dayEnd: 1440, weekdaysOnly: false, minMinutes: 1 });
}

interface Booking {
  contactIds: string[];
  title: string;
  location: string;
  date: string;
  startMin: number;
  duration: number;
  deadline: string;
  share: boolean;
}

export function createGroupEvent(user: User, booking: Booking) {
  const { date, startMin, duration, share } = booking;
  const title = booking.title.trim();
  const location = booking.location.trim();
  const contactIds = [...new Set(booking.contactIds)];
  if (!title || title.length > 120) throw new InvitationError("Enter an event title of up to 120 characters.");
  if (location.length > 200) throw new InvitationError("Use a location of up to 200 characters.");
  if (!contactIds.length && !share) throw new InvitationError("Choose a contact or enable a guest link.");
  const endMin = startMin + duration;
  if (!Number.isInteger(startMin) || startMin < 0 || !Number.isInteger(duration) || duration < 1 || endMin > 1440) {
    throw new InvitationError("Choose a start time and duration within one free window.");
  }
  const start = localInstant(`${date}T${formatMinutes(startMin)}`);
  if (start === null || start <= Date.now() || (endMin < 1440 && localInstant(`${date}T${formatMinutes(endMin)}`) === null)) {
    throw new InvitationError("Choose a valid future time in Timișoara.");
  }
  const deadline = localInstant(booking.deadline);
  return getDb().transaction((tx) => {
    if (deadline === null || deadline <= Date.now() || deadline > start) {
      throw new InvitationError("Set the reply deadline after now and at or before the event starts.");
    }
    // Check the current calendars and contact permissions under the same write lock as the booking.
    const windows = groupAvailability(user, contactIds, { from: date, to: date });
    if (!windows.some((w) => w.startMin <= startMin && endMin <= w.endMin)) {
      throw new InvitationError("That time is no longer free for everyone. Check the available times again.");
    }
    const id = randomUUID();
    tx.insert(groupEvents).values({
      id, creatorId: user.id, title, location: location || null, date, startMin, endMin,
      deadline, shareToken: share ? randomBytes(24).toString("base64url") : null,
    }).run();
    tx.insert(eventParticipants).values([
      { eventId: id, userId: user.id, invited: true, response: "accepted" },
      ...contactIds.map((userId) => ({ eventId: id, userId, invited: true, response: "pending" as const })),
    ]).run();
    return id;
  }, { behavior: "immediate" });
}
