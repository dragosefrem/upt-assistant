import { DATE_LOCALE, isLocale, type Locale } from "@/i18n/config";
import { common } from "@/i18n/messages/common";

/**
 * All timetable times are wall-clock times in Timișoara. Dates are handled as ISO
 * "YYYY-MM-DD" strings and minutes-since-midnight, so nothing depends on the server's
 * own time zone.
 */
export const TIME_ZONE = "Europe/Bucharest";


/** An interface language ("ro", "en") or a full BCP 47 tag, as Intl wants it. */
function intlLocale(locale: string): string {
  return isLocale(locale) ? DATE_LOCALE[locale] : locale;
}

const partsFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Current date and minute-of-day in Timișoara. */
export function nowLocal(at: Date = new Date()): { date: string; minutes: number } {
  const p = Object.fromEntries(partsFormat.formatToParts(at).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, minutes: +p.hour * 60 + +p.minute };
}

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 1 = Monday … 7 = Sunday. */
export function weekday(date: string): number {
  return ((utc(date).getUTCDay() + 6) % 7) + 1;
}

export function mondayOf(date: string): string {
  return addDays(date, 1 - weekday(date));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((utc(to).getTime() - utc(from).getTime()) / 86_400_000);
}

export function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** A meeting published with a start time alone uses equal start and end minutes. */
export function formatTimeSlot(start: number, end: number): string {
  return start === end ? formatMinutes(start) : formatMinutes(start) + "–" + formatMinutes(end);
}

export function isDatedMeeting(rule: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(rule);
}

/** A dated meeting can also occur during a teaching break. Day changes stay in its original week. */
export function occursInWeek(rule: string, teachingWeek: number | null, monday: string): boolean {
  return isDatedMeeting(rule) ? mondayOf(rule) === monday : teachingWeek !== null && weekMatches(rule, teachingWeek);
}

/** A datetime-local input value in the campus time zone. */
export function localDateTime(at: number = Date.now()): string {
  const { date, minutes } = nowLocal(new Date(at));
  return `${date}T${formatMinutes(minutes)}`;
}

/** Resolve a campus wall time, including DST. A skipped minute has no instant.
 * When the clock repeats an hour, use its first occurrence. */
export function localInstant(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall) || new Date(wall).toISOString().slice(0, 16) !== value) return null;
  const candidates = [-1, 1].map((day) => {
    const sample = wall + day * 86_400_000;
    const offset = Date.parse(`${localDateTime(sample)}:00Z`) - sample;
    return wall - offset;
  });
  return candidates.sort((a, b) => a - b).find((at) => localDateTime(at) === value) ?? null;
}

/** `locale` is an interface language ("ro", "en") or a BCP 47 tag. */
export function formatDate(
  date: string,
  opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" },
  locale: Locale | string = "en",
): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { ...opts, timeZone: "UTC" }).format(utc(date));
}

export function formatDateRange(from: string, to: string, locale: Locale | string = "en"): string {
  const end = formatDate(to, { day: "numeric", month: "long", year: "numeric" }, locale);
  if (from === to) return end;
  if (from.slice(0, 7) === to.slice(0, 7)) return `${Number(from.slice(8))}–${end}`;
  const start = formatDate(from, { day: "numeric", month: "long", year: from.slice(0, 4) === to.slice(0, 4) ? undefined : "numeric" }, locale);
  return `${start} – ${end}`;
}

/** English weekday names, for data sent to the assistant model and for logs. Interface text uses `dayName`. */
export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** First letter in upper case, for a word that starts a label ("luni" → "Luni"). */
export function capitalize(text: string): string {
  return text ? text.charAt(0).toLocaleUpperCase() + text.slice(1) : text;
}

/**
 * Weekday name in the interface language, 1 = Monday … 7 = Sunday. Capitalised, because
 * it nearly always starts a label; Romanian short names lose their trailing dot.
 */
export function dayName(day: number, locale: Locale | string = "en", style: "long" | "short" = "long"): string {
  if (!(day >= 1 && day <= 7)) return "";
  // 2024-01-01 was a Monday.
  const name = new Intl.DateTimeFormat(intlLocale(locale), { weekday: style, timeZone: "UTC" }).format(new Date(Date.UTC(2024, 0, day)));
  return capitalize(name.replace(/\.$/, ""));
}

/** Commas list teaching weeks or ranges. An ampersand combines restrictions. */
export function weekMatches(rule: string, week: number): boolean {
  if (rule.includes("&")) return rule.split("&").every((part) => weekMatches(part, week));
  if (rule.startsWith("!")) return !weekMatches(rule.slice(1), week);
  if (rule.includes(",")) return rule.split(",").some((part) => weekMatches(part, week));
  // "alt": held every other week, and the published timetable does not say which. It stays
  // in every week, with a note, rather than being shown in the wrong half.
  if (rule === "all" || rule === "alt") return true;
  if (rule === "odd") return week % 2 === 1;
  if (rule === "even") return week % 2 === 0;
  const m = /^(\d+)-(\d+)$/.exec(rule);
  return m ? week >= +m[1] && week <= +m[2] : /^\d+$/.test(rule) && week === +rule;
}

export function describeWeeks(rule: string, locale: Locale = "en"): string | null {
  const t = common[locale].time;
  if (isDatedMeeting(rule)) return formatDate(rule, { day: "numeric", month: "long", year: "numeric" }, locale);
  if (rule.includes("&")) return rule.split("&").map((part) => describeWeeks(part, locale)).join(", ");
  if (rule === "all") return null;
  if (rule === "alt") return t.alternating;
  if (rule === "odd") return t.oddWeeks;
  if (rule === "even") return t.evenWeeks;
  if (rule.startsWith("!")) return t.except(describeWeeks(rule.slice(1), locale) ?? "");
  return /^\d+$/.test(rule) ? t.weekN(rule) : t.weeksList(rule.replaceAll(",", ", "));
}
