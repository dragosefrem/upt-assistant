import type { FreeSlot } from "./schedule";
import { z } from "zod";
import { addDays, daysBetween } from "./time";

export interface DateRange {
  from: string;
  to: string;
}

/** Why a requested range was rejected; the page shows `contacts.errors[code]`. */
export type PlanningRangeError = "invalidDates" | "endBeforeStart" | "pastRange";

export const PLANNING_PAGE_DAYS = 31;
export const PLANNING_PRESETS = [7, 14, 30] as const;
const isoDate = z.iso.date();

export function nextDays(today: string, count: number): DateRange {
  return { from: today, to: addDays(today, count - 1) };
}

/** Resolve inclusive calendar dates. Long ranges are queried one page at a time. */
export function planningRange(today: string, params: { from?: unknown; to?: unknown; page?: unknown }) {
  let range = nextDays(today, 7);
  let error: PlanningRangeError | undefined;
  if (params.from !== undefined || params.to !== undefined) {
    const from = isoDate.safeParse(params.from);
    const to = isoDate.safeParse(params.to);
    if (!from.success || !to.success) {
      error = "invalidDates";
    } else if (to.data < from.data) {
      error = "endBeforeStart";
    } else if (to.data < today) {
      error = "pastRange";
    } else {
      // A saved link can be reopened after part of the range has passed.
      range = { from: from.data < today ? today : from.data, to: to.data };
    }
  }
  const totalDays = daysBetween(range.from, range.to) + 1;
  const pageCount = Math.ceil(totalDays / PLANNING_PAGE_DAYS);
  const requested = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;
  const page = Math.max(1, Math.min(pageCount, requested));
  const offset = (page - 1) * PLANNING_PAGE_DAYS;
  const visible = {
    from: addDays(range.from, offset),
    to: addDays(range.from, Math.min(offset + PLANNING_PAGE_DAYS, totalDays) - 1),
  };
  return { range, visible, page, pageCount, totalDays, error };
}

export interface AvailabilityDay {
  date: string;
  slots: FreeSlot[];
  freeMinutes: number;
}

/** Hour filters; the label is `contacts.availability.hours[id]`. */
export const hourViews = [
  { id: "full", startMin: 0, endMin: 1440 },
  { id: "daytime", startMin: 480, endMin: 1080 },
  { id: "evening", startMin: 1080, endMin: 1440 },
] as const;

export type CampusTime = { date: string; minutes: number };

export function availabilityDays(range: DateRange, slots: FreeSlot[], asOf: CampusTime, hours: typeof hourViews[number] = hourViews[0]): AvailabilityDay[] {
  const days = Array.from({ length: daysBetween(range.from, range.to) + 1 }, (_, i): AvailabilityDay => ({
    date: addDays(range.from, i), slots: [], freeMinutes: 0,
  }));
  const nextQuarter = Math.ceil((asOf.minutes + 1) / 15) * 15;
  for (const slot of slots) {
    const startMin = Math.max(hours.startMin, slot.startMin, slot.date === asOf.date ? nextQuarter : 0);
    const endMin = Math.min(hours.endMin, slot.endMin);
    if (startMin >= endMin) continue;
    const day = days[daysBetween(range.from, slot.date)];
    day.slots.push({ date: slot.date, startMin, endMin });
    day.freeMinutes += endMin - startMin;
  }
  return days;
}
