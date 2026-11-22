import type { EntryKind } from "@/db/schema";
import { squash } from "./text";

/**
 * Turns one timetable cell into structured fields.
 *
 * Faculties write cells differently — "Programare Web (c) R. Cioargă sala 303CP",
 * "BE1, seminar, SPM 210, M.Vartolomei", "LP1(l) B418a" — so parsing is a sequence of
 * tolerant extractions. Anything not recognised stays available through `raw`.
 */
export interface ParsedText {
  /** Course name as written; may be just an acronym for labs. */
  name: string;
  /** Explicit acronym when the cell provides one ("(BE1)") or when the name is one. */
  abbr: string | null;
  kind: EntryKind;
  hasKindMarker: boolean;
  room: string | null;
  teacher: string | null;
  /** Teaching-week restriction consumed by weekMatches. */
  weeks: string;
  raw: string;
}

const KIND_BY_LETTER: Record<string, EntryKind> = {
  c: "course", curs: "course", course: "course", lecture: "course",
  s: "seminar", sem: "seminar", seminar: "seminar",
  l: "lab", lab: "lab", laborator: "lab",
  p: "project", pr: "project", proiect: "project", project: "project",
};

const PAREN_KIND = /\(\s*(curs|course|lecture|seminar|sem|laborator|lab|proiect|project|pr|c|s|l|p)\b[^)]*\)/i;
const WORD_KIND = /(?:[,;]|\s[-‐–]|(?<=\))\s+)\s*(curs|seminar|sem|laborator|lab|proiect|pr)\b\.?|\s+(curs|seminar|laborator|lab|proiect)(?=\s*(?:[.,;]|\bsal[aă]\b|[sșş]\.l\.|prof\.|conf\.|$))/i;

/** "(curs facultativ)", "(c.f.)", "Pedagogie (c) - facultativ": a class students may leave out. */
const FACULTATIVE = /\(\s*c\.\s*f\.?\s*\)|\(\s*fac\.?\s*\)|(?<![\p{L}])facultativ[ăe]?(?![\p{L}])/iu;

export function isFacultative(text: string): boolean {
  return FACULTATIVE.test(text);
}

export function hasKindMarker(text: string): boolean {
  return PAREN_KIND.test(text) || WORD_KIND.test(text);
}

const ROOM_KEYWORD =
  /(?:\bsal[aă]|\bamf(?:iteatru(?:l)?)?\.?|\broom|\b(?<![a-z])ala)\s*:?\s*([\p{L}\d][\p{L}\d .\/-]*?)(?=\s*(?:[,;(]|$|\d+\s*h\s*\/|s[aă]pt|week|\bonline\b))/iu;

/** A bare room code such as B413, 301CP, A105, SPM 210, D1, Ca3, B418a, N305. */
const ROOM_CODE =
  /(?<![\p{L}\d.])((?:[A-Z]{1,4}\s?\d{1,4}[A-Za-z]?(?:\s?[A-Z]{2,6})?)|(?:\d{2,4}\s?[A-Z]{1,4})|Ca\d|ASPC|CIDUCOS)(?![\p{L}\d])/u;

const TEACHER =
  /(?<![\p{L}])((?:\p{Lu}\.\s?){1,3}-?\s?\p{Lu}[\p{L}'’-]+(?![\p{L}\d'’-])(?:\s\p{Lu}[\p{L}'’-]+(?![\p{L}\d'’-]))?)/u;

/** Where the lecturer begins after a room: an academic title, or an initial and a surname. */
const AFTER_ROOM = /\s+(?=(?:Prof|Conf|Asist|Lect|Drd)\b\.?|[SȘŞ]\.?\s?l\.|\p{Lu}\.\s?\p{Lu}\p{L})/u;

/**
 * A building written beside the room ("A2 Chimie", "SPM parter P01", "Orologerie building,
 * Room 206", "Sala 225 A (SPM)"), with the floor some timetables add. It says where the room
 * is, so it is kept with the room and never mistaken for the lecturer.
 */
const BUILDING =
  /(?<![\p{L}\d])(?:(\d{2,4}[A-Za-z]?)\s+)?\(?(?:(?:Facultatea\s+de|Cl[aă]direa)\s+)?(Chimie(?!\s+Centru)|Mecanic[aă]|Hidrotehnic[aă]|Orologerie|SPM|ASPC)\)?(?![\p{L}\d])(?:\s+building)?(?:\s+(\d{2,4}[A-Za-z]?)(?![\p{L}\d]))?(?:[\s,;(]*(?:parter|et(?:aj(?:ul)?)?\.?\s*(?:[IVX]+|\d+)|corp(?:ul)?\s+[\p{L}\d]+)(?![\p{L}\d])\)?)*/iu;

const weekWord = String.raw`(?:s[aă]pt(?:[aă]m[aâ]n(?:ile|a|ă|i))?\.?|weeks?|s\.|s(?=\s*[:.]?\s*\d{1,2}\s*[-–÷]))`;
const parityWord = String.raw`(?:imp(?:ar[aăe]?)?|par[aăe]?|[pi](?=\.))`;
const weekNumber = String.raw`\d{1,2}(?:\s*[-–÷]\s*s?\d{1,2})?`;
const numberedWeeks = new RegExp(String.raw`(?<![\p{L}\d.])(${weekWord})\s*[:.]?\s*(${weekNumber}(?:\s*[,/]\s*${weekNumber}(?!\s*h\b))*)(?!\d|[.:]\d|\s*[-–÷]\s*\d)`, "giu");

/**
 * A lecture whose length changes during the term: "3 h sapt.1-4, 2 h sapt. 5-12",
 * "sapt.1-8 (3 h), sapt. 9-10 (2 h)", "(s:1-8 2h, s:9-12 3h)". Each part with its weeks and
 * hours, in the order written; empty unless at least two parts are given.
 */
export function hourLoads(text: string): Array<{ weeks: string; hours: number }> {
  const range = String.raw`(\d{1,2})\s*[-–÷]\s*(\d{1,2})`;
  const word = String.raw`(?:s[aă]pt\w*\.?|s\s*[:.])`;
  const before = [...text.matchAll(new RegExp(String.raw`(\d)\s*h\s*,?\s*${word}\s*${range}`, "giu"))].map((m) => ({ hours: +m[1], from: +m[2], to: +m[3] }));
  const after = [...text.matchAll(new RegExp(String.raw`${word}\s*${range}\s*\(?\s*(\d)\s*h\b\)?`, "giu"))].map((m) => ({ hours: +m[3], from: +m[1], to: +m[2] }));
  const loads = before.length >= 2 ? before : after.length >= 2 ? after : [];
  return loads.every((l) => l.hours >= 1 && l.hours <= 6 && l.from >= 1 && l.to >= l.from && l.to <= 20)
    ? loads.map((l) => ({ weeks: `${l.from}-${l.to}`, hours: l.hours })) : [];
}
const parityWeeks = new RegExp(String.raw`(?<![\p{L}\d.])${weekWord}\s*[:.]?\s*(${parityWord})(?!\p{L})\.?`, "giu");

function extractWeeks(input: string) {
  const numbers = new Set<string>();
  const parities = new Set<string>();
  let rest = input.replace(/\d+\s*h\s*\/\s*\d+\s*s[aă]pt\w*/gi, " ");
  rest = rest.replace(/\bprimele\s+(\d{1,2})\s+s[aă]pt(?:[aă]m[aâ]ni)?\b\.?/gi, "săpt. 1-$1");
  // "ultimele 7 sapt.": the last seven of the fourteen teaching weeks.
  rest = rest.replace(/\bultimele\s+(\d{1,2})\s+s[aă]pt(?:[aă]m[aâ]ni)?\b\.?/gi,
    (match, n: string) => (+n >= 1 && +n <= 13 ? `săpt. ${15 - +n}-14` : match));
  rest = rest.replace(/\((\d{1,2}\s*[-–÷]\s*\d{1,2})\s+s[aă]pt\.?\)/gi, "(săpt. $1)");
  // "sapt. (1-11)"
  rest = rest.replace(/(\bs[aă]pt\.?)\s*\(\s*(\d{1,2}\s*[-–÷]\s*\d{1,2})\s*\)/gi, "$1 $2");
  // "10 săpt": the first ten weeks, which the same timetables also spell "primele 10 săptămâni".
  // "14 săpt x 2h" is an hour load, and a count for the whole semester restricts nothing.
  // A range cut off by the end of the cell ("s:1-") says nothing.
  rest = rest.replace(/(?<![\p{L}\d])s\s*[:.]\s*\d{1,2}\s*[-–÷]\s*$/iu, " ");
  // "laborator 7 săpt + proiect 7 săpt" adds up to the semester: two counts restrict nothing.
  const counted = /(?<![\d\p{L}]|[-–÷/x×*]\s*)(\d{1,2})\s+s[aă]pt(?:[aă]m[aâ]ni)?\b\.?(?!\s*[x×*:]|\s*\d)/giu;
  if ([...rest.matchAll(counted)].length === 1) {
    rest = rest.replace(counted, (match, n: string) => (+n >= 2 && +n <= 13 ? `săpt. 1-${n}` : match));
  }
  // "Fizica (L) par (gr 2.1)": the parity alone, right after the kind.
  rest = rest.replace(/(?<=\([CSLP]\)\s*)((?:im)?par[aăe]?)(?![\p{L}])/giu, "săpt. $1");
  // "sala 311 impar": the parity alone, after everything else.
  rest = rest.replace(/(?<=[\p{L}\d)]\s+)((?:im)?par[aăe]?)\s*$/iu, "săpt. $1");
  rest = rest.replace(/(\bs[aă]pt\.?\s*\d{1,2}\s*[-–÷]\s*\d{1,2})\s*:\s*((?:im)?par[aăe]?)(?!\p{L})/giu, "$1 săpt. $2");
  rest = rest.replace(numberedWeeks, (match, label: string, list: string) => {
    // "S. 1 (s)" can itself be the subject. A lone week needs an explicit week label.
    if (/^s\.$/i.test(label) && /^\d+$/.test(list)) return match;
    const parts = list.replace(/[\ss]/gi, "").replace(/[–÷]/g, "-").split(/[,/]/);
    if (!parts.every((p) => {
      const [from, to = from] = p.split("-").map(Number);
      return from >= 1 && to >= from && to <= 53;
    })) return match;
    for (const part of parts) numbers.add(part);
    return " ";
  });
  rest = rest.replace(parityWeeks, (_, flag: string) => {
    parities.add(/^i/i.test(flag) ? "odd" : "even");
    return " ";
  });
  const weeks = [numbers.size ? [...numbers].join(",") : "", parities.size === 1 ? [...parities][0] : ""]
    .filter(Boolean).join("&") || "all";
  // What is left of "[S1-S12]*" or "(s:1-8 2h, s:9-12 3h)" once the weeks are read.
  rest = rest.replace(/\[\s*\]\*?/g, " ").replace(/\(\s*(?:\d+\s*h\b[\s,;]*)*\)/gi, " ");
  return { weeks, rest: rest.replace(/^\s*[:.]\s*/, "").trim() };
}

function clean(s: string): string {
  return squash(s.replace(/^[\s,;:.\-–|]+|[\s,;:\-–|]+$/g, ""));
}

function looksLikeAcronym(name: string): boolean {
  const compact = name.replace(/[\s.]/g, "");
  if (!compact || compact.length > 8) return false;
  if (/\s/.test(name.trim()) && name.trim().split(/\s+/).length > 2) return false;
  const upper = compact.replace(/[^\p{Lu}\d]/gu, "").length;
  return upper >= Math.ceil(compact.length * 0.6);
}

export function parseCellText(input: string): ParsedText {
  const raw = squash(input.replace(/\n/g, " "));
  const annotations = extractWeeks(raw);
  let weeks = annotations.weeks;
  const text = annotations.rest.replace(/^(?:gr\.?\s*[FG12]\.?|G[12])\s*\/?\s+/i, "");

  let kind: EntryKind = "other";
  let marker = false;
  let name = text;
  let rest = "";

  const paren = PAREN_KIND.exec(text);
  const word = WORD_KIND.exec(text);
  if (paren && (!word || paren.index <= word.index)) {
    kind = KIND_BY_LETTER[paren[1].toLowerCase()] ?? "other";
    marker = true;
    name = text.slice(0, paren.index);
    rest = text.slice(paren.index + paren[0].length);
    if (/online/i.test(paren[0])) rest = `online ${rest}`;
  } else if (word) {
    kind = KIND_BY_LETTER[(word[1] ?? word[2]).toLowerCase()] ?? "other";
    marker = true;
    name = text.slice(0, word.index);
    rest = text.slice(word.index + word[0].length);
  }

  // MPT trailing parity flag: "…, O.Irizoiu, p" / "…, i".
  const flag = /[,;]\s*([pi])\s*$/i.exec(rest);
  if (flag && marker) {
    weeks = flag[1].toLowerCase() === "p" ? "even" : "odd";
    rest = rest.slice(0, flag.index);
  }

  if (!marker) {
    // No activity type: split a trailing room/teacher off the title where obvious.
    const cut = /[,;]/.exec(text);
    if (cut) {
      name = text.slice(0, cut.index);
      rest = text.slice(cut.index + 1);
    }
    if (/^curs\s+/i.test(name)) { kind = "course"; marker = true; }
  }

  // "(C)-MN sala M204": the course's acronym, written right after its type.
  let markedAbbr: string | null = null;
  const after = marker ? /^\s*[-–]\s*(\p{Lu}[\p{Lu}\d]{1,7})(?=\s+(?:sal[aă]|room|amf)\b)/iu.exec(rest) : null;
  if (after) {
    markedAbbr = after[1];
    rest = rest.slice(after[0].length);
  }

  let room: string | null = null;
  const keyword = ROOM_KEYWORD.exec(rest);
  if (keyword) {
    // "sala M204 Conf. univ. dr. ing. Carmen OPRIȘ": the room ends where the lecturer begins.
    const [code, ...lecturer] = keyword[1].split(AFTER_ROOM);
    room = clean(code);
    rest = rest.replace(keyword[0], ` ${lecturer.join(" ")} `);
  }

  let teacher: string | null = null;
  const t = TEACHER.exec(rest);
  if (t) {
    teacher = clean(t[1]).replace(/\.(?=\p{L})/gu, ". ");
    rest = rest.replace(t[0], " ");
  }

  if (!room) {
    const code = ROOM_CODE.exec(rest);
    if (code) {
      // "401 A,B,C": the studios of one floor, listed by their letters.
      const more = /^(?:\s*,\s*[A-Z](?![\p{L}\d]))+/u.exec(rest.slice(code.index + code[0].length));
      room = clean(code[1]) + (more ? more[0].replace(/\s/g, "") : "");
      rest = rest.slice(0, code.index) + " " + rest.slice(code.index + code[0].length + (more ? more[0].length : 0));
    }
  }
  if (!room && /\bonline\b/i.test(rest)) room = "online";

  // "Chimie" or "Mecanica" alone can be a subject; beside a room they say where the room is.
  const building = BUILDING.exec(rest);
  if (building && room !== "online" && (room || (marker && /^(?:SPM|ASPC|Orologerie)$/i.test(building[2])))) {
    rest = rest.replace(building[0], " ");
    const [, before, name, number] = building;
    // "MCS (L) Orologerie 405", "M (S) 112 Orologerie": the number beside the building is the room.
    if (!room) room = before ? `${before} ${name}` : number ? `${name} ${number}` : name;
    else if (!room.toLowerCase().includes(name.toLowerCase())) room = `${room} ${name}`;
  }

  if (!marker && !room) {
    // "TUTORIERE Ca3": a room code glued to the end of an untyped title.
    const tail = new RegExp(`\\s${ROOM_CODE.source}\\s*$`, "u").exec(name);
    if (tail) {
      room = clean(tail[1]);
      name = name.slice(0, tail.index);
    }
  }

  if (!teacher) {
    const leftover = clean(rest.replace(/\bonline\b/gi, " "));
    if (leftover && leftover.length <= 40 && /^\p{Lu}/u.test(leftover) && !/\d/.test(leftover) && /\p{L}{3}/u.test(leftover)) {
      teacher = leftover;
    }
  }

  name = clean(name);
  let abbr: string | null = null;
  const explicit = /\(([\p{Lu}][\p{L}\d.]{0,7})\)\s*$/u.exec(name);
  if (explicit && name.length > explicit[0].length + 3) {
    abbr = explicit[1];
    name = clean(name.slice(0, explicit.index));
  } else if (looksLikeAcronym(name)) {
    abbr = name.replace(/\s+/g, "");
  } else if (markedAbbr) {
    abbr = markedAbbr;
  }

  return { name: name || raw, abbr, kind, hasKindMarker: marker, room, teacher, weeks, raw };
}
