/**
 * All timetable times are wall-clock times in Timișoara. Dates are handled as ISO
 * "YYYY-MM-DD" strings and minutes-since-midnight, so nothing depends on the server's
 * own time zone.
 */
export const TIME_ZONE = "Europe/Bucharest";

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

export function formatDate(date: string, opts: Intl.DateTimeFormatOptions = { weekday: "long", day: "numeric", month: "long" }, locale = "en-GB"): string {
  return new Intl.DateTimeFormat(locale, { ...opts, timeZone: "UTC" }).format(utc(date));
}

export const DAY_NAMES = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
export const DAY_SHORT = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Commas list teaching weeks or ranges. An ampersand combines restrictions. */
export function weekMatches(rule: string, week: number): boolean {
  if (rule.includes("&")) return rule.split("&").every((part) => weekMatches(part, week));
  if (rule.startsWith("!")) return !weekMatches(rule.slice(1), week);
  if (rule.includes(",")) return rule.split(",").some((part) => weekMatches(part, week));
  if (rule === "all") return true;
  if (rule === "odd") return week % 2 === 1;
  if (rule === "even") return week % 2 === 0;
  const m = /^(\d+)-(\d+)$/.exec(rule);
  return m ? week >= +m[1] && week <= +m[2] : /^\d+$/.test(rule) && week === +rule;
}

export function describeWeeks(rule: string): string | null {
  if (isDatedMeeting(rule)) return formatDate(rule, { day: "numeric", month: "long", year: "numeric" });
  if (rule.includes("&")) return rule.split("&").map(describeWeeks).join(", ");
  if (rule === "all") return null;
  if (rule === "odd") return "odd weeks";
  if (rule === "even") return "even weeks";
  if (rule.startsWith("!")) return `except ${describeWeeks(rule.slice(1))}`;
  return /^\d+$/.test(rule) ? `week ${rule}` : `weeks ${rule.replaceAll(",", ", ")}`;
}
