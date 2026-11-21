import "server-only";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { savedContacts } from "@/db/schema";
import type { User } from "./auth";
import { contactEvents } from "./contact-schedule";
import { acceptedScheduleContacts, type ScheduleContact } from "./contacts";
import { tentativeTimesFor } from "./group-events";
import { describeGroup, eventsBetween, groupBusy, overlaps } from "./schedule";

/**
 * The people a student can plan around, whichever way they were added:
 *
 * - an **account** contact accepted the student's request (or the other way round), so
 *   their real calendar counts: classes after their own choices, exams, personal events
 *   and group events they said yes to;
 * - a **saved** contact is only a name and a group ("Andreea is in TI 3.2"), so the
 *   group's published timetable stands in for them.
 *
 * An account contact's sharing preference determines whether class and exam titles are visible.
 */
export type Person =
  | ({ kind: "account" } & ScheduleContact)
  | { kind: "saved"; id: number; name: string; groupId: number | null };

export interface BusyTime {
  date: string;
  startMin: number;
  endMin: number;
  /** A class or exam title; null when the time is private. */
  what: string | null;
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();

/** Everyone the student can plan around, account contacts first, each kind by name. */
export function listPeople(userId: string): Person[] {
  const accounts: Person[] = acceptedScheduleContacts(userId)
    .map((c) => ({ kind: "account" as const, ...c }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const saved: Person[] = getDb()
    .select()
    .from(savedContacts)
    .where(eq(savedContacts.userId, userId))
    .all()
    .map((c) => ({ kind: "saved" as const, id: c.id, name: c.name, groupId: c.groupId }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...accounts, ...saved];
}

/**
 * People whose name matches a loose query. An exact name wins outright; otherwise any
 * name that contains the query or one of whose words starts with it ("Ana" finds
 * "Ana Pop", "pop" finds her too).
 */
export function matchPeople(people: Person[], query: string): Person[] {
  const q = fold(query);
  if (!q) return [];
  const exact = people.filter((p) => fold(p.name) === q);
  if (exact.length) return exact;
  return people.filter((p) => {
    const name = fold(p.name);
    return name.split(/\s+/).some((word) => word.startsWith(q)) || (q.length >= 3 && (name.includes(q) || q.includes(name)));
  });
}

/** A short description of where the person studies, for telling namesakes apart. */
export function personGroup(person: Person): string | null {
  if (person.kind === "account" && !person.shareActivityDetails) return null;
  const info = describeGroup(person.groupId);
  return info ? `${info.spec.code ?? info.spec.name}, year ${info.group.year}, ${info.label}` : null;
}

/** When a person is taken between two dates. */
export function personBusy(person: Person, from: string, to: string): BusyTime[] {
  if (person.kind === "saved") {
    return person.groupId ? groupBusy(person.groupId, from, to).map((b) => ({ date: b.date, startMin: b.startMin, endMin: b.endMin, what: b.title })) : [];
  }
  return contactEvents(person, from, to).map((event) => ({
    date: event.date, startMin: event.startMin, endMin: event.endMin,
    what: event.kind === "busy" ? null : event.title,
  }));
}

export interface Availability {
  person: Person;
  free: boolean;
  /** What overlaps the slot, earliest first. */
  busy: BusyTime[];
  /** False for a saved contact whose group is unknown: nothing can be said about them. */
  known: boolean;
}

/** Who among `people` is free for the whole of a time slot on one date. */
export function availabilityAt(people: Person[], date: string, startMin: number, endMin: number): Availability[] {
  const slot = { startMin, endMin };
  return people.map((person) => {
    const known = person.kind === "account" || person.groupId != null;
    const busy = personBusy(person, date, date)
      .filter((b) => overlaps(b, slot))
      .sort((a, b) => a.startMin - b.startMin);
    return { person, free: known && busy.length === 0, busy, known };
  });
}

/** The student's own clashes with a slot, so "are we all free?" includes them. */
export function ownBusyAt(user: User, date: string, startMin: number, endMin: number): BusyTime[] {
  const events = eventsBetween(user, date, date).map(e => ({ date: e.date, startMin: e.startMin, endMin: e.endMin, what: e.title }));
  const pending = tentativeTimesFor(user.id, date, date).map(e => ({ ...e, what: null }));
  return [...events, ...pending].filter(e => overlaps(e, { startMin, endMin }));
}
