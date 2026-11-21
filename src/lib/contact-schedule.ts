import "server-only";
import { z } from "zod";
import { acceptedScheduleContacts } from "./contacts";
import { sharedEventsFor, tentativeTimesFor } from "./group-events";
import { describeGroup, eventsBetween, type CalEvent, type FreeSlot } from "./schedule";
import { addDays, mondayOf, nowLocal } from "./time";

type ContactEvent = FreeSlot & {
  title: string;
  kind: CalEvent["kind"] | "busy";
  room: string | null;
};

function busyTime({ date, startMin, endMin }: FreeSlot): ContactEvent {
  return { date, startMin, endMin, title: "Busy", kind: "busy", room: null };
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

export function contactWeek(viewerId: string, contactId: string, date?: string) {
  const [contact] = acceptedScheduleContacts(viewerId, [contactId]);
  if (!contact) return null;

  const from = weekStart(date);
  const to = addDays(from, 6);
  const sharedWithViewer = new Set(sharedEventsFor(viewerId, from, to).map((e) => e.id));
  const events: ContactEvent[] = eventsBetween(contact, from, to).map((event) => {
    if (event.type === "class" || event.type === "exam" || (event.groupEventId && sharedWithViewer.has(event.groupEventId))) {
      const { date, startMin, endMin, title, kind, room } = event;
      return { date, startMin, endMin, title, kind, room };
    }
    return busyTime(event);
  });
  events.push(...tentativeTimesFor(contact.id, from, to).map(busyTime));
  events.sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.endMin - b.endMin);

  const group = describeGroup(contact.groupId);
  return {
    name: contact.name,
    group: group && [group.faculty.shortName ?? group.faculty.name, group.spec.code ?? group.spec.name, `Year ${group.group.year}`, group.label].join(" · "),
    from, to, events,
  };
}
