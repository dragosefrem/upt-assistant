import "server-only";
import { scheduler } from "node:timers/promises";
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { faculties, sponsoredEvents, sponsoredResponses, users } from "@/db/schema";
import type { Locale } from "@/i18n/config";
import type { User } from "./auth";
import { tentativeTimesFor } from "./group-events";
import { eventsBetween, overlaps, type FreeSlot } from "./schedule";
import { addDays, formatMinutes, localInstant, mondayOf, nowLocal } from "./time";

type SponsoredEvent = typeof sponsoredEvents.$inferSelect;
type Audience = Pick<SponsoredEvent, "facultyIds" | "years">;
type Slot = FreeSlot & Audience;
export type SponsoredOffer = Pick<SponsoredEvent, "id" | "title" | "sponsor" | "description" | "location" | "date" | "startMin" | "endMin">;
export type SponsoredChoice = "save" | "hide" | "undoHide" | "remove";

const clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).transform((s) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3)));
const ids = z.array(z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.int().positive()))
  .transform((v) => [...new Set(v)].sort((a, b) => a - b));

export function readSponsoredSlot(form: FormData): { slot: Slot } | { error: "time" | "audience" } {
  const date = z.iso.date().safeParse(form.get("date"));
  const start = clock.safeParse(form.get("start"));
  const end = clock.safeParse(form.get("end"));
  if (!date.success || !start.success || !end.success || end.data <= start.data) return { error: "time" };
  const startAt = localInstant(`${date.data}T${formatMinutes(start.data)}`);
  const endAt = localInstant(`${date.data}T${formatMinutes(end.data)}`);
  if (startAt === null || startAt <= Date.now() || endAt === null) return { error: "time" };

  const selected = ids.safeParse(form.getAll("faculty"));
  const years = ids.safeParse(form.getAll("year"));
  if (!selected.success || !years.success || years.data.some((y) => y > 6)) return { error: "audience" };
  if (selected.data.length) {
    const known = new Set(getDb().select({ id: faculties.id }).from(faculties).all().map((f) => f.id));
    if (selected.data.some((id) => !known.has(id))) return { error: "audience" };
  }
  return { slot: { date: date.data, startMin: start.data, endMin: end.data, facultyIds: selected.data, years: years.data } };
}

function matchesAudience(event: Audience, user: Pick<User, "role" | "onboardedAt" | "facultyId" | "year">) {
  return user.role === "student" && !!user.onboardedAt
    && (!event.facultyIds.length || (user.facultyId !== null && event.facultyIds.includes(user.facultyId)))
    && (!event.years.length || (user.year !== null && event.years.includes(user.year)));
}

function upcoming(event: FreeSlot, today: string) {
  if (event.date !== today) return event.date > today;
  // The start instant is unambiguous even when the campus clock repeats an hour.
  const start = localInstant(`${event.date}T${formatMinutes(event.startMin)}`);
  return start !== null && start > Date.now();
}

function fits(slot: FreeSlot, busy: FreeSlot[]) {
  return !busy.some((b) => b.date === slot.date && overlaps(slot, {
    startMin: b.startMin,
    // A start-only entry occupies its published minute, including at the slot's start.
    endMin: Math.max(b.endMin, b.startMin + 1),
  }));
}

function calendarIsFree(user: Parameters<typeof eventsBetween>[0], slot: FreeSlot) {
  return fits(slot, eventsBetween(user, slot.date, slot.date)) && fits(slot, tentativeTimesFor(user.id, slot.date, slot.date));
}

/** Suggestions are filtered before serialization and never become busy time themselves. */
export function sponsoredOffers(user: User, from: string, to: string, scheduled: FreeSlot[]): SponsoredOffer[] {
  const today = nowLocal().date;
  if (user.role !== "student" || !user.onboardedAt || to < today) return [];
  const candidates = getDb().select({ event: sponsoredEvents }).from(sponsoredEvents)
    .leftJoin(sponsoredResponses, and(eq(sponsoredResponses.eventId, sponsoredEvents.id), eq(sponsoredResponses.userId, user.id)))
    .where(and(eq(sponsoredEvents.cancelled, false), isNull(sponsoredResponses.eventId),
      gte(sponsoredEvents.date, from > today ? from : today), lte(sponsoredEvents.date, to)))
    .orderBy(asc(sponsoredEvents.date), asc(sponsoredEvents.startMin), asc(sponsoredEvents.title), asc(sponsoredEvents.id)).all()
    .map(({ event }) => event).filter((e) => matchesAudience(e, user) && upcoming(e, today));
  if (!candidates.length) return [];
  const busy = [...scheduled, ...tentativeTimesFor(user.id, from, to)];
  return candidates.filter((e) => fits(e, busy)).map(({ id, title, sponsor, description, location, date, startMin, endMin }) =>
    ({ id, title, sponsor, description, location, date, startMin, endMin }));
}

/** The home week also surfaces upcoming opportunities before students navigate to their dates. */
export function calendarWithOffers(user: User, from: string, to: string, locale: Locale) {
  const today = nowLocal().date;
  const homeWeek = from === mondayOf(today) && to === addDays(from, 6);
  const through = homeWeek ? addDays(today, 14) : to;
  const scheduled = eventsBetween(user, from, through, locale);
  return {
    events: homeWeek ? scheduled.filter((e) => e.date <= to) : scheduled,
    offers: sponsoredOffers(user, from, through, scheduled),
  };
}

/** Run only when an administrator requests a count for a particular audience and time. */
export async function sponsoredReach(slot: Slot) {
  const students = getDb().select({
    id: users.id, groupId: users.groupId, specializationId: users.specializationId, facultyId: users.facultyId, year: users.year,
  }).from(users).where(and(eq(users.role, "student"), isNotNull(users.onboardedAt),
    slot.facultyIds.length ? inArray(users.facultyId, slot.facultyIds) : undefined,
    slot.years.length ? inArray(users.year, slot.years) : undefined)).all();
  let free = 0;
  for (const [index, student] of students.entries()) {
    // Let other requests run between batches of synchronous SQLite timetable reads.
    if (index > 0 && index % 32 === 0) await scheduler.yield();
    if (calendarIsFree(student, slot)) free++;
  }
  return { total: students.length, free };
}

export function respondToSponsoredEvent(userId: string, eventId: string, choice: SponsoredChoice): boolean {
  const ownResponse = and(eq(sponsoredResponses.userId, userId), eq(sponsoredResponses.eventId, eventId));
  return getDb().transaction((tx) => {
    if (choice === "remove" || choice === "undoHide") {
      tx.delete(sponsoredResponses).where(and(ownResponse, eq(sponsoredResponses.response, choice === "remove" ? "saved" : "hidden"))).run();
      return true;
    }
    const event = tx.select().from(sponsoredEvents).where(eq(sponsoredEvents.id, eventId)).get();
    const user = tx.select({ id: users.id, role: users.role, onboardedAt: users.onboardedAt, facultyId: users.facultyId,
      year: users.year, groupId: users.groupId, specializationId: users.specializationId }).from(users).where(eq(users.id, userId)).get();
    if (!event || !user || event.cancelled || !matchesAudience(event, user) || !upcoming(event, nowLocal().date)) return false;
    const response = choice === "save" ? "saved" : "hidden";
    const previous = tx.select().from(sponsoredResponses).where(ownResponse).get();
    if (previous) return previous.response === response;
    // Recheck under the write lock so two overlapping offers cannot both be saved.
    if (!calendarIsFree(user, event)) return false;
    tx.insert(sponsoredResponses).values({ userId: user.id, eventId, response }).run();
    return true;
  }, { behavior: "immediate" });
}
