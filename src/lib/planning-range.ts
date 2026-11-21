import { z } from "zod";
import { addDays, daysBetween } from "./time";

export interface DateRange {
  from: string;
  to: string;
}

export const PLANNING_PAGE_DAYS = 31;
export const PLANNING_PRESETS = [7, 14, 30] as const;
const isoDate = z.iso.date();

export function nextDays(today: string, count: number): DateRange {
  return { from: today, to: addDays(today, count - 1) };
}

/** Resolve inclusive calendar dates. Long ranges are queried one page at a time. */
export function planningRange(today: string, params: { from?: unknown; to?: unknown; page?: unknown }) {
  let range = nextDays(today, 7);
  let error: string | undefined;
  if (params.from !== undefined || params.to !== undefined) {
    const from = isoDate.safeParse(params.from);
    const to = isoDate.safeParse(params.to);
    if (!from.success || !to.success) {
      error = "Enter a valid start date and end date.";
    } else if (to.data < from.data) {
      error = "The end date must be on or after the start date.";
    } else if (to.data < today) {
      error = "Choose a date range that includes today or a future day.";
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
