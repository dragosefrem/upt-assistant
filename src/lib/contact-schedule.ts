import "server-only";
import { z } from "zod";
import type { Locale } from "@/i18n/config";
import { common } from "@/i18n/messages/common";
import { contacts } from "@/i18n/messages/contacts";
import { acceptedScheduleContacts, type ScheduleContact } from "./contacts";
import { sharedEventsFor, tentativeTimesFor } from "./group-events";
import { describeGroup, eventsBetween, type CalEvent, type FreeSlot } from "./schedule";
import { addDays, capitalize, mondayOf, nowLocal } from "./time";

type ContactEvent = FreeSlot & {
  title: string;
  kind: CalEvent["kind"] | "busy";
  room: string | null;
};

function busyTime({ date, startMin, endMin }: FreeSlot, title: string): ContactEvent {
  return { date, startMin, endMin, title, kind: "busy", room: null };
}

function sharedEventIds(viewerId: string, from: string, to: string) {
  return new Set(sharedEventsFor(viewerId, from, to).map((event) => event.id));
}

/** Return only the event details an accepted contact is allowed to see. */
export function contactEvents(
  contact: ScheduleContact, from: string, to: string, locale: Locale = "en", sharedWithViewer?: ReadonlySet<string>,
): ContactEvent[] {
  const busy = contacts[locale].schedule.busy;
  const events = eventsBetween(contact, from, to, locale).map((event) => {
    const shared = event.groupEventId && sharedWithViewer?.has(event.groupEventId);
    if (contact.shareActivityDetails && (event.type === "class" || event.type === "exam" || shared)) {
      const { date, startMin, endMin, title, kind, room } = event;
      return { date, startMin, endMin, title, kind, room };
    }
    return busyTime(event, busy);
  });
  events.push(...tentativeTimesFor(contact.id, from, to).map((slot) => busyTime(slot, busy)));
  events.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.endMin - b.endMin);
  if (contact.shareActivityDetails) return events;

  // Two adjacent or overlapping commitments disclose only one continuous busy interval.
  const blocks: ContactEvent[] = [];
  for (const event of events) {
    const last = blocks.at(-1);
    if (last && last.date === event.date && event.startMin <= last.endMin) {
      last.endMin = Math.max(last.endMin, event.endMin);
    } else {
      blocks.push(event);
    }
  }
  return blocks;
}

export type ContactStatus =
  | { state: "free" | "busy" }
  | ({ state: "activity" } & Pick<CalEvent, "kind" | "title" | "room">);

function statusAt(events: ContactEvent[], minute: number): ContactStatus {
  let state: "free" | "busy" = "free";
  for (const event of events) {
    if (minute < event.startMin || minute >= event.endMin) continue;
    if (event.kind !== "busy") return { state: "activity", kind: event.kind, title: event.title, room: event.room };
    state = "busy";
  }
  return { state };
}

export function currentContactStatuses(viewerId: string, locale: Locale = "en", now = nowLocal()) {
  const people = acceptedScheduleContacts(viewerId);
  const statuses = new Map<string, ContactStatus>();
  if (!people.length) return statuses;
  const shared = sharedEventIds(viewerId, now.date, now.date);
  for (const person of people) {
    const events = contactEvents(person, now.date, now.date, locale, shared);
    statuses.set(person.id, statusAt(events, now.minutes));
  }
  return statuses;
}

const calendarDate = z.iso.date();

function weekStart(date?: string) {
  const parsed = calendarDate.safeParse(date);
  if (parsed.success) {
    const start = mondayOf(parsed.data);
    if (calendarDate.safeParse(start).success && calendarDate.safeParse(addDays(start, 6)).success) return start;
  }
  return mondayOf(nowLocal().date);
}

/** One week of an accepted contact's calendar; private commitments become "Busy" in `locale`. */
export function contactWeek(viewerId: string, contactId: string, date?: string, locale: Locale = "en") {
  const [contact] = acceptedScheduleContacts(viewerId, [contactId]);
  if (!contact) return null;

  const from = weekStart(date);
  const to = addDays(from, 6);
  const events = contactEvents(contact, from, to, locale, sharedEventIds(viewerId, from, to));
  const group = contact.shareActivityDetails ? describeGroup(contact.groupId, locale) : null;
  return {
    name: contact.name,
    group: group && [group.faculty.shortName ?? group.faculty.name, group.spec.code ?? group.spec.name, capitalize(common[locale].time.year(group.group.year)), group.label].join(" · "),
    from, to, events,
  };
}
