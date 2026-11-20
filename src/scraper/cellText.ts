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
  /** "all" | "odd" | "even" | "a-b" */
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
const WORD_KIND = /[,;]\s*(curs|seminar|laborator|lab|proiect)\b\.?/i;

export function hasKindMarker(text: string): boolean {
  return PAREN_KIND.test(text) || WORD_KIND.test(text);
}

const ROOM_KEYWORD =
  /(?:\bsal[aă]|\bamf(?:iteatru(?:l)?)?\.?|\broom|\b(?<![a-z])ala)\s*:?\s*([\p{L}\d][\p{L}\d .\/-]*?)(?=\s*(?:[,;(]|$|\d+\s*h\s*\/|s[aă]pt|week|\bonline\b))/iu;

/** A bare room code such as B413, 301CP, A105, SPM 210, D1, Ca3, B418a, N305. */
const ROOM_CODE =
  /(?<![\p{L}\d.])((?:[A-Z]{1,4}\s?\d{1,4}[A-Za-z]?(?:\s?[A-Z]{2,6})?)|(?:\d{2,4}\s?[A-Z]{1,4})|Ca\d|ASPC|CIDUCOS)(?![\p{L}\d])/u;

const TEACHER =
  /(?<![\p{L}])((?:\p{Lu}\.\s?){1,3}-?\s?\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?)/u;

function extractWeeks(text: string): { weeks: string; rest: string } {
  let rest = text;
  let weeks = "all";
  const rangeRe =
    /(?:s[aă]pt(?:[aă]m[aâ]n(?:a|i|ile))?\.?|weeks?|\bs)\s*(\d{1,2})\s*[-–]\s*(\d{1,2})\b/i;
  const m = rangeRe.exec(rest);
  if (m) {
    weeks = `${+m[1]}-${+m[2]}`;
    rest = rest.replace(m[0], " ");
  } else {
    const parity = /s[aă]pt(?:[aă]m[aâ]n(?:a|i|ile))?\.?\s*(imp(?:ar[aăe]?)?|par[aăe]?)\b\.?/i.exec(rest);
    if (parity) {
      weeks = /^imp/i.test(parity[1]) ? "odd" : "even";
      rest = rest.replace(parity[0], " ");
    }
  }
  // Hour-load annotations ("2h/12sapt") describe the course, not when it runs.
  rest = rest.replace(/\d+\s*h\s*\/\s*\d+\s*s[aă]pt\w*/gi, " ");
  return { weeks, rest };
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
  let text = raw;

  // Leading qualifiers used by some faculties: "Gr. F", "Sapt. imp.".
  let weeks = "all";
  for (let i = 0; i < 3; i++) {
    const parity = /^s[aă]pt\.?\s*(imp(?:ar[aăe]?)?|par[aăe]?)\.?\s+/i.exec(text);
    if (parity) {
      weeks = /^imp/i.test(parity[1]) ? "odd" : "even";
      text = text.slice(parity[0].length);
      continue;
    }
    const group = /^gr\.?\s*[\p{L}\d]{1,2}\.?\s+/iu.exec(text);
    if (group) {
      text = text.slice(group[0].length);
      continue;
    }
    break;
  }

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
    kind = KIND_BY_LETTER[word[1].toLowerCase()] ?? "other";
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
  }

  const w = extractWeeks(rest);
  rest = w.rest;
  if (w.weeks !== "all") weeks = w.weeks;
  const nameWeeks = extractWeeks(name);
  if (nameWeeks.weeks !== "all") {
    weeks = nameWeeks.weeks;
    name = nameWeeks.rest;
  }

  let room: string | null = null;
  const keyword = ROOM_KEYWORD.exec(rest);
  if (keyword) {
    room = clean(keyword[1]);
    rest = rest.replace(keyword[0], " ");
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
      room = clean(code[1]);
      rest = rest.replace(code[0], " ");
    }
  }
  if (!room && /\bonline\b/i.test(rest)) room = "online";

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
    if (leftover && leftover.length <= 40 && /^\p{Lu}/u.test(leftover) && !/\d/.test(leftover)) {
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
  }

  return { name: name || raw, abbr, kind, hasKindMarker: marker, room, teacher, weeks, raw };
}
