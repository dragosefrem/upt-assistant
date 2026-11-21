import type { Locale } from "@/i18n/config";
import { common } from "@/i18n/messages/common";
import { addDays } from "./time";

type HolidayKey = keyof typeof common.en.holidays;
export interface PublicHoliday {
  date: string;
  name: string;
}

// The national holidays listed in Article 139 of Romania's Labour Code.
const fixed: [string, HolidayKey][] = [
  ["01-01", "newYear"], ["01-02", "newYearSecond"], ["01-06", "epiphany"], ["01-07", "john"],
  ["01-24", "union"], ["05-01", "labour"], ["06-01", "children"], ["08-15", "dormition"],
  ["11-30", "andrew"], ["12-01", "national"], ["12-25", "christmas"], ["12-26", "christmasSecond"],
];
const movable: [number, HolidayKey][] = [
  [-2, "goodFriday"], [0, "easter"], [1, "easterMonday"], [49, "pentecost"], [50, "pentecostMonday"],
];

/** Julian computus, then conversion of its March/April date to the Gregorian calendar. */
export function orthodoxEaster(year: number): string {
  const moon = (19 * (year % 19) + 15) % 30;
  const sunday = (2 * (year % 4) + 4 * (year % 7) - moon + 34) % 7;
  const calendarOffset = Math.floor(year / 100) - Math.floor(year / 400) - 2;
  return addDays(`${String(year).padStart(4, "0")}-03-22`, moon + sunday + calendarOffset);
}

const cache = new Map<number, Map<string, HolidayKey[]>>();

function holidaysInYear(year: number): Map<string, HolidayKey[]> {
  const cached = cache.get(year);
  if (cached) return cached;
  const byDate = new Map<string, HolidayKey[]>();
  for (const [day, key] of fixed) byDate.set(`${String(year).padStart(4, "0")}-${day}`, [key]);
  const easter = orthodoxEaster(year);
  for (const [offset, key] of movable) {
    const date = addDays(easter, offset);
    byDate.set(date, [...(byDate.get(date) ?? []), key]);
  }
  cache.set(year, byDate);
  return byDate;
}

export function isPublicHoliday(date: string): boolean {
  return holidaysInYear(Number(date.slice(0, 4))).has(date);
}

/** Inclusive calendar range. Two observances on one day share a single label. */
export function holidaysBetween(from: string, to: string, locale: Locale = "en"): PublicHoliday[] {
  const result: PublicHoliday[] = [];
  const names = common[locale].holidays;
  for (let year = Number(from.slice(0, 4)); year <= Number(to.slice(0, 4)); year++) {
    for (const [date, keys] of holidaysInYear(year)) {
      if (date >= from && date <= to) result.push({ date, name: keys.map((key) => names[key]).join(" / ") });
    }
  }
  return result.sort((a, b) => a.date.localeCompare(b.date));
}
