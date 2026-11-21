/** Text helpers shared by the scraper's parsers. Pure functions, no I/O. */

export function stripDiacritics(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

export function squash(s: string): string {
  return s.replace(/[\s ]+/g, " ").trim();
}

/** Lower-case, diacritic-free, punctuation-free form used for fuzzy matching. */
export function norm(s: string): string {
  return squash(
    stripDiacritics(s)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " "),
  );
}

export function slugify(s: string): string {
  return norm(s).replace(/ /g, "-");
}

const STOP_WORDS = new Set([
  "si", "de", "ale", "a", "al", "ai", "cu", "pe", "la", "in", "din", "pentru", "prin", "sau",
  "and", "of", "the", "for", "in", "to", "on", "with",
]);

/**
 * Timetables write lectures in full ("Sisteme de operare 2") and labs as an acronym
 * ("SO2"). Building the same acronym from the full name lets both resolve to one course.
 */
export function acronym(name: string): string {
  return norm(name)
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => (/^\d+$/.test(w) ? w : w[0]))
    .join("")
    .toUpperCase();
}

const DAY_WORDS: Array<[RegExp, number]> = [
  [/^(luni|lu|mon|monday)$/, 1],
  [/^(marti|ma|tue|tues|tuesday)$/, 2],
  [/^(miercuri|mi|wed|wednesday)$/, 3],
  [/^(joi|jo|thu|thur|thurs|thursday)$/, 4],
  [/^(vineri|vi|fri|friday)$/, 5],
  [/^(sambata|sa|sat|saturday)$/, 6],
  [/^(duminica|du|sun|sunday)$/, 7],
];

/** Weekday number (1 = Monday) for a Romanian or English day word, else null. */
export function parseDayWord(word: string): number | null {
  const w = norm(word);
  for (const [re, day] of DAY_WORDS) if (re.test(w)) return day;
  return null;
}

/** Day names long enough to be unambiguous inside free text ("Marti 10-12"). */
export const DAY_IN_TEXT =
  /\b(luni|mar[tţț]i|miercuri|joi|vineri|s[aâ]mb[aă]t[aă]|duminic[aă]|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat)\b/gi;

export interface TimeRange {
  startMin: number;
  endMin: number;
}

/** An explicit clock interval in the activity can narrow the surrounding timetable row. */
export function activityTime(text: string, slot: TimeRange): TimeRange {
  const times = [...text.matchAll(/\(\s*(\d{1,2}(?:[.:]\d{2})?\s*[-–]\s*\d{1,2}(?:[.:]\d{2})?)\s*\)/g)];
  if (times.length !== 1) return slot;
  const time = parseTimeRange(times[0][1]);
  return time && time.startMin >= slot.startMin && time.endMin <= slot.endMin ? time : slot;
}

/** Parses "08-09", "8 - 10", "20:21", "08:00-10:00", "8.30-10". */
export function parseTimeRange(text: string): TimeRange | null {
  const t = squash(text).replace(/[_‐‑−]/g, "-");
  const full = /^(\d{1,2})[:.](\d{2})\s*[-–—]\s*(\d{1,2})[:.](\d{2})$/.exec(t);
  if (full) return range(+full[1], +full[2], +full[3], +full[4]);
  const mixed = /^(\d{1,2})(?:[:.](\d{2}))?\s*[-–—]\s*(\d{1,2})(?:[:.](\d{2}))?$/.exec(t);
  if (mixed) return range(+mixed[1], +(mixed[2] ?? 0), +mixed[3], +(mixed[4] ?? 0));
  // Some sheets type a colon instead of a dash between whole hours: "20:21".
  const colon = /^(\d{1,2}):(\d{1,2})$/.exec(t);
  if (colon && +colon[2] > +colon[1] && +colon[2] <= 24) return range(+colon[1], 0, +colon[2], 0);
  return null;
}

function range(h1: number, m1: number, h2: number, m2: number): TimeRange | null {
  if (h1 > 23 || h2 > 24 || m1 > 59 || m2 > 59) return null;
  const startMin = h1 * 60 + m1;
  const endMin = h2 * 60 + m2;
  return endMin > startMin ? { startMin, endMin } : null;
}

export function romanToInt(s: string): number | null {
  const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  return map[s.toUpperCase()] ?? null;
}

/** Study year mentioned in a heading: "ANUL III", "An 2", "3rd Year", "anul I". */
export function parseStudyYear(text: string): number | null {
  const t = stripDiacritics(text);
  const ro = /\ban(?:ul)?\.?\s*(IV|VI|V|I{1,3}|[1-6])\b/i.exec(t);
  if (ro) return romanToInt(ro[1]) ?? +ro[1];
  const en = /\b([1-6])(?:st|nd|rd|th)\s+year\b/i.exec(t) ?? /\byear\s+([1-6])\b/i.exec(t);
  if (en) return +en[1];
  return null;
}

export function formatMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
