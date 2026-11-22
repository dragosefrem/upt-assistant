import { hasKindMarker, hourLoads, isFacultative, parseCellText } from "./cellText";
import { activityTime, norm, parseDayWord, parseTimeRange, squash, type TimeRange } from "./text";
import type { NormalizedGroup, NormalizedTimetable } from "./types";

/** Printed coordinates, measured from the top left of a page or worksheet. */
export type Box = [left: number, top: number, right: number, bottom: number, text: string];
export interface PrintedColumn {
  left: number;
  right: number;
  group: NormalizedGroup;
  weeks?: string;
}

const roomOnly = /^(?:sal[aă]\s+[\p{L}\d .-]{1,14}|(?:[A-Z]{1,3}\s?-?\d{2,4}[a-z]?|\d{2,4}[A-Z]{1,3}|Ca\d+|NM|PN|V[Vv]))$/u;
const staffTitle = /(?:\b(?:asist|prof|conf|lect)\s*\.|[sșş](?:ef\s+lucr|\s*\.\s*l)\.)/i;
/** A lecturer alone on a line, as an initial and a surname: "C Turc", "D. Ostoia". */
const teacherLine = /^\p{Lu}\.?\s+\p{Lu}\p{Ll}+(?:[-\s]\p{Lu}\p{Ll}+)?$/u;
/** A sub-heading inside the grid that limits the classes below it to some weeks: "S1-S7". */
const weekHeading = /^S\s?(\d{1,2})\s*[-–]\s*S\s?(\d{1,2})$/i;

/**
 * What is typed in a box, without the marks that spill over from the neighbouring cell of a
 * diagonal split: a lone ")" or "`" on its own line, and "Fizica (L" that lost its bracket.
 */
function boxText(text: string): string {
  const lines = text.split("\n").filter((line) => /[\p{L}\d]/u.test(line));
  return lines.join("\n").replace(/\(\s*([CSLP])\s*$/i, "($1)");
}

const continuation = /^(?:(?:\([CSLP]\)\s*)?(?:s[aă]pt\w*\.?\s*(?:\d+\s*[-–]\s*\d+|imp\w*|par\w*)|\([CSLP]\))\s*$|(?:asist|prof|conf|lect)\.|[sșş]ef\s+lucr)/i;

/**
 * IEE years 2 to 4 shorten "săptămâni pare / impare" to SP and SI: "TCE, lab, SP, C304",
 * "CS2, lab, D010 S.I.", "SP: IA, lab". Two subgroups share each room and slot, one marked SP
 * and the other SI, which is what tells the letters apart from a lecturer's initials.
 */
function electricalWeeks(text: string) {
  return text.replace(/(?<![\p{L}\d])S\.?\s?([PI])(?![\p{L}\d])\.?(?=\s*(?:[,;:/]|$|[A-Za-z]\s?\d))/gu,
    (_, parity: string) => (parity === "P" ? "săpt. pare" : "săpt. impare"));
}

/** A class held in another faculty's building names it first: "Facultatea de Chimie, sala A2, …". */
const elsewhere = /^(?:Facultatea\s+de\s+)?(Chimie|Mecanic[aă]|Hidrotehnic[aă])\s*,\s*sal[aă]\s+([A-Z]{0,3}\s?\d{1,4}[a-z]?)\s*[,;]\s*(?=\S)/iu;

/** IEE prints the room first and the kind after the lecturer's name. */
export function electricalCell(input: string) {
  let raw = electricalWeeks(squash(input)).replace(/^sg\.\s*\d+\s*\/\s*\d+\s*[,;]\s*/i, "")
    // "MNCE pr.S.I C423", "IA pr D010": the project, named in a word of its own.
    .replace(/(?<![\p{L}\d])pr(?![\p{L}\d])\.?\s*/iu, "(P) ")
    // "c423" for C423.
    .replace(/(?<![\p{L}\d])([a-f])(?=\d{3}(?![\p{L}\d]))/gu, (wing) => wing.toUpperCase());
  const away = elsewhere.exec(raw);
  if (away) raw = raw.slice(away[0].length);
  const room = /^(?:sal[aă]\s*((?:[A-Z]+\s*)?\d{2,4}[a-z]?)|([A-Z]\s?\d{2,4}[a-z]?|SPM\s*\d+))[\s,;]+(?=\S)/iu.exec(raw);
  const rest = room ? raw.slice(room[0].length) : raw;
  const title = staffTitle.exec(rest);
  const type = /\(\s*(C|S|L|P|curs|seminar|lab|laborator|proiect)\b[^)]*\)/i.exec(rest);
  const end = Math.min(title?.index ?? rest.length, type?.index ?? rest.length);
  const course = rest.slice(0, end).replace(/[,;\s]+$/, "");
  const parsed = parseCellText(type && course ? `${course} ${type[0]} ${rest.slice(end).replace(type[0], "")}` : rest);
  if (room) parsed.room = room[1] ?? room[2];
  if (away) parsed.room = `${away[2]} ${away[1]}`;
  if (title) parsed.teacher = rest.slice(title.index).split(/\s*\([CSLP]\)|\bs[aă]pt\.?|[,;]\s*(?:sala|[A-F]\d)/i)[0].replace(/[,;\s]+$/, "") || null;
  return parsed;
}

/** IEE also names the kind in a word with no brackets or commas: "MNCE pr.S.I C423", "IA pr D010". */
const electricalKind = (text: string) => hasKindMarker(text) || /(?<![\p{L}\d])(?:lab|sem|pr|curs)(?![\p{L}\d])/iu.test(text);
const electricalRoom = /(?<![\p{L}\d])[A-Z]\s?\d{3}[a-z]?(?![\p{L}\d])/u;

/**
 * The activities of one cell. Two that take turns are written one under the other or on one
 * line with a slash, each with its weeks: "MNCE lab. S.P, C423/ MNCE pr.S.I C423" is the lab
 * in even weeks and the project in odd weeks; "IEJT (P) s. 2-6" over "IEJT (L) s. 7-11" a
 * project that becomes a lab. Read as one, the second was lost.
 */
export function electricalActivities(text: string): string[] {
  // On one line or wrapped over several, with a slash between the two.
  // Not the slash of a subgroup ("sg. 3/2") or of two rooms ("409/410").
  const halves = squash(text).split(/\s*(?:(?<!\d\s*)\/|\/(?!\s*\d))\s*(?=\S)/);
  if (halves.length === 2 && halves.every(electricalKind)) {
    // "SP: IA, lab / SI: IA pr D010": the room both share is written once, at the end.
    const shared = new RegExp(electricalRoom.source + "\\s*$", "u").exec(halves[1]);
    if (shared && !electricalRoom.test(halves[0])) halves[0] += `, ${shared[0].trim()}`;
    return halves;
  }
  // One under the other: both name their kind in brackets, and the first says when it is held
  // (odd or even weeks, or a range of weeks that the second continues).
  const parity = (part: string) => /(?:\bs\.|s[aă]pt\.?)\s*(?:imp|par)/i.test(electricalWeeks(part));
  const range = (part: string) => /(?:\bs\.|s[aă]pt\.?)\s*\d{1,2}\s*[-–]\s*\d{1,2}/i.test(part);
  const parts: string[] = [];
  for (const line of text.split(/\n/)) {
    const last = parts.at(-1);
    if (last && !(hasKindMarker(last) && hasKindMarker(line) && (parity(last) || (range(last) && range(line))))) {
      parts[parts.length - 1] += "\n" + line;
    } else parts.push(line);
  }
  return parts;
}

/** Civil Engineering puts the room and lecturer on a second line below the title. */
const civilRoom = /^(?:[Ss]al[aă]\s+)?(LG\s*\d+|[A-Z]{1,3}\s?-?\d+[a-z]?|PN|NM|V[Vv]|\d+)\b\s*(.*)$/u;
export function civilDetail(text: string) { return civilRoom.test(squash(text)); }

/** A lecture is titled in capitals, with its lecturer after it: "GEOMETRIE DESCRIPTIVĂ C.Voicu". */
const civilLecture = /^([^\p{Ll}]*\p{Lu}{4}[^\p{Ll}]*?)\s+((?:\p{Lu}\.\s?)*\p{Lu}\p{Ll}[\p{L}. -]*)$/u;

export function civilCell(raw: string) {
  const lines = raw.trim().split(/\n+/).map(squash);
  // "Sală" alone is the caption of the room box drawn at the end of a lecture's row.
  while (lines.length > 1 && /^sal[aă]$/i.test(lines.at(-1)!)) lines.pop();
  const last = lines.at(-1) ?? "";
  const detail = lines.length > 1 ? civilRoom.exec(last) : null;
  const parsed = parseCellText((detail ? lines.slice(0, -1) : lines).join(" "));
  if (detail) {
    parsed.room = detail[1];
    if (detail[2]) parsed.teacher = detail[2];
  }
  // In the year-2 layout the caption of the room box comes first: "Sală GEOLOGIE INGINEREASCĂ".
  parsed.name = parsed.name.replace(/^Sal[aă]\s+(?=\p{Lu}{3})/u, "");
  const lecture = parsed.teacher ? null : civilLecture.exec(parsed.name);
  if (lecture) {
    parsed.name = lecture[1].trim();
    parsed.teacher = lecture[2].trim();
  }
  // "AMENAJĂRI HIDROTEHNICE H1": the hall, written after the title.
  const hall = parsed.room ? null : /\s([A-Z]{1,3}\d{1,4}[a-z]?|NM|PN|VV)$/.exec(parsed.name);
  if (hall) {
    parsed.room = hall[1];
    parsed.name = parsed.name.slice(0, hall.index).trim();
  }
  return parsed;
}

function dayOf(text: string) {
  const word = norm(text).replaceAll(" ", "");
  return parseDayWord(word) ?? parseDayWord([...word].reverse().join("")) ??
    ({ mierc: 3, niul: 1, tiram: 2, riucremi: 3, oij: 4 } as Record<string, number>)[word];
}

/** Resolve each activity against its own hour column. Some pages print several clocks
 * side by side, with different hours on precisely the same physical row. */
export function readPrintedTable(
  cells: Box[], sheet: string,
  columnsFor: (header: Box[], clockRight: number) => PrintedColumn[],
  documentWeeks = "all",
  parse = parseCellText,
  options: {
    splitSharedHours?: boolean; splitActivities?: (text: string) => string[]; isDetail?: (text: string) => boolean;
    /** Whether an activity of a shared cell is for this group: "Fizica (L) sapt. pare (gr 1.1)". */
    isFor?: (activity: string, group: NormalizedGroup) => boolean;
  } = {},
): NormalizedTimetable {
  const result: NormalizedTimetable = { groups: [], entries: [], warnings: [] };
  const byX = new Map<number, Array<{ box: Box; time: TimeRange; day: number }>>();
  for (const box of cells) {
    const time = parseTimeRange(box[4]);
    if (!time) continue;
    const key = Math.round(box[0]);
    const rows = byX.get(key) ?? [];
    rows.push({ box, time, day: 0 });
    byX.set(key, rows);
  }
  const clocks = [...byX.values()].filter((rows) => rows.length >= 3).sort((a, b) => a[0].box[0] - b[0].box[0]);
  if (!clocks.length) return result;
  const first = Math.min(...clocks[0].map((r) => r.box[1]));
  const header = cells.filter((b) => b[3] <= first + 0.05);
  const columns = columnsFor(header, clocks[0][0].box[2]);
  if (!columns.length) return result;
  const days = cells.flatMap((b) => {
    const day = dayOf(b[4]);
    return day ? [{ box: b, day }] : [];
  });
  for (const clock of clocks) {
    let day = 0;
    let previous = Infinity;
    for (const row of clock.sort((a, b) => a.box[1] - b.box[1])) {
      const middle = (row.box[1] + row.box[3]) / 2;
      const label = days.find((d) => d.box[1] <= middle && middle < d.box[3]);
      if (label) day = label.day;
      else if (row.time.startMin < previous) day++;
      row.day = day;
      previous = row.time.startMin;
    }
  }

  // Odd/even columns can share the same subgroup. A merged activity belongs to both weeks.
  const groupIds = new Map<string, number>();
  const indexed = columns.map((c) => {
    const key = JSON.stringify(c.group);
    if (!groupIds.has(key)) {
      groupIds.set(key, result.groups.length);
      result.groups.push(c.group);
    }
    return { ...c, id: groupIds.get(key)! };
  });
  const dayAt = (y: number) => clocks[0].find((r) => r.box[1] <= y && y < r.box[3])?.day;
  /** Every box as it is printed in one piece somewhere on the page. */
  const whole = new Set(cells.map((c) => squash(boxText(c[4]))));
  const aligned = new Map<string, Box>();
  const blocks: Box[] = [];
  /** Where the first box of a class ended, before the lines below were joined to it. */
  const heads = new Map<Box, number>();
  const detailCell = (text: string) => roomOnly.test(text) || !!options.isDetail?.(text);
  for (const b of cells.filter((b) => b[1] >= first && indexed.some((c) => c.left < b[2] && c.right > b[0]))
    .sort((a, b) => a[1] - b[1])) {
    const key = b[0] + "|" + b[2];
    const above = aligned.get(key);
    b[4] = boxText(b[4]);
    const raw = squash(b[4]);
    if (!raw) continue;
    // A class cut in two by a line the printout does not have: "DA (L) Lab AR" over
    // "D Ostoia" where the next group's cell reads "DA (L) Lab AR / D Ostoia" in one piece.
    const restOfAbove = !!above && !hasKindMarker(raw) && hasKindMarker(above[4]) &&
      (whole.has(squash(above[4] + " " + raw)) || teacherLine.test(raw));
    // The room of a lecture for the whole series is boxed at the end of its row, in the last
    // group's column. It belongs to that lecture, not to the class above it in the column.
    const besideLecture = detailCell(raw) && cells.some((left) => Math.abs(left[2] - b[0]) < 0.05 &&
      Math.abs(left[1] - b[1]) < 0.05 && Math.abs(left[3] - b[3]) < 0.05 && left[2] - left[0] > (b[2] - b[0]) * 1.5 &&
      !detailCell(squash(left[4])) && !parseTimeRange(left[4]) && !dayOf(left[4]));
    if (above && !besideLecture && (continuation.test(raw) || detailCell(raw) || restOfAbove) && Math.abs(above[3] - b[1]) < 0.05
      && dayAt((above[1] + above[3]) / 2) === dayAt((b[1] + b[3]) / 2)
      && !parseTimeRange(above[4]) && !dayOf(above[4]) && !detailCell(squash(above[4]))) {
      if (!heads.has(above)) heads.set(above, above[3]);
      above[4] += "\n" + b[4];
      above[3] = b[3];
    } else {
      const copy: Box = [...b];
      blocks.push(copy);
      aligned.set(key, copy);
    }
  }
  // The same from left to right: a class held every week is one cell over the odd and the even
  // column, and its text comes back cut at the line between them ("MN (L) Cristian Pop" and
  // "Orologerie 408 (etaj IV)"). Read apart, the room became a class of the even weeks.
  for (const b of [...blocks]) {
    const right = blocks.find((r) => r !== b && Math.abs(r[0] - b[2]) < 0.05 && Math.abs(r[1] - b[1]) < 0.05 && Math.abs(r[3] - b[3]) < 0.05);
    if (right && hasKindMarker(b[4]) && !hasKindMarker(right[4]) && whole.has(squash(b[4] + " " + right[4]))) {
      b[2] = right[2];
      b[4] += "\n" + right[4];
      blocks.splice(blocks.indexOf(right), 1);
    }
  }
  const weekHeadings = blocks.flatMap((b) => {
    const range = weekHeading.exec(squash(b[4]));
    return range ? [{ box: b, weeks: `${Number(range[1])}-${Number(range[2])}` }] : [];
  });
  // MEC prints two hours per clock label. A change between two full-cohort
  // activities inside that label marks the intermediate hour, even when the
  // spreadsheet rows were printed with unequal heights.
  if (options.splitSharedHours) {
    const left = Math.min(...indexed.map((c) => c.left)), right = Math.max(...indexed.map((c) => c.right));
    const shared = blocks.filter((b) => b[0] <= left + 0.5 && b[2] >= right - 0.5);
    const boundaries = [...new Set(shared.map((b) => b[1]))].filter((y) => shared.some((b) => Math.abs(b[3] - y) < 0.05));
    for (const clock of clocks) {
      const refined = clock.flatMap((row) => {
        const [x, top, r, bottom, label] = row.box;
        const cuts = boundaries.filter((y) => y > top + 0.05 && y < bottom - 0.05);
        if (row.time.endMin - row.time.startMin !== 120 || cuts.length !== 1) return [row];
        const mid = row.time.startMin + 60;
        return [
          { ...row, box: [x, top, r, cuts[0], label] as Box, time: { ...row.time, endMin: mid } },
          { ...row, box: [x, cuts[0], r, bottom, label] as Box, time: { ...row.time, startMin: mid } },
        ];
      });
      clock.splice(0, clock.length, ...refined);
    }
  }
  for (const b of blocks) {
    const raw = squash(b[4]);
    if (parseTimeRange(raw) || dayOf(raw) || !/\p{L}/u.test(raw) || detailCell(raw) || continuation.test(raw) || weekHeading.test(raw)) continue;
    const adjoiningRoom = cells.find((r) => roomOnly.test(squash(r[4])) && Math.abs(r[0] - b[2]) < 0.05 &&
      Math.abs(r[1] - b[1]) < 0.05 && Math.abs(r[3] - b[3]) < 0.05);
    const covered = indexed.filter((c) => Math.min(c.right, adjoiningRoom?.[2] ?? b[2]) - Math.max(c.left, b[0]) > 0.1);
    if (!covered.length) continue;
    // A narrow continuation line under a course often only supplies the room.
    const clock = clocks.filter((rows) => rows[0].box[2] <= b[0] + 0.5).at(-1);
    if (!clock) continue;
    const rows = clock.filter(({ box }) => {
      const overlap = Math.min(b[3], box[3]) - Math.max(b[1], box[1]);
      return overlap > 0 && overlap >= Math.min(b[3] - b[1], box[3] - box[1]) * 0.49;
    });
    const start = rows[0], end = rows.at(-1);
    if (!start || !end || start.day !== end.day || start.day < 1 || start.day > 7) continue;
    // On a grid of two-hour rows, a three-hour class ("8-11") is drawn across one row and half
    // of the next: an edge inside a row falls on the hour between its two.
    const hourAt = (y: number, fallback: number) => {
      const row = clock.find(({ box, day }) => day === start.day && box[1] < y - 0.05 && y < box[3] - 0.05);
      const span = row ? row.time.endMin - row.time.startMin : 0;
      if (!row || span < 120) return fallback;
      return row.time.startMin + Math.round(((y - row.box[1]) / (row.box[3] - row.box[1])) * (span / 60)) * 60;
    };
    // That holds for a class that runs from one row into another. A box that lies inside a
    // single row is the written half of a cell split by a diagonal: the class lasts the whole row.
    const inOneRow = clock.some(({ box, day }) => day === start.day && box[1] <= b[1] + 0.05 && b[3] <= box[3] + 0.05);
    // Mecanică's rows are not drawn to scale: there, a class put together from two boxes whose
    // first line sat inside one row starts with that row ("GDDT (L) Farkas A." written
    // half-way down 18-20, with its room in 20-21). Construcții does draw to scale: a title in
    // the lower half of 14-16 with its room in the upper half of 16-18 is a class from 15 to 17.
    const head = options.splitSharedHours ? heads.get(b) : undefined;
    const headInRow = head !== undefined && clock.some(({ box, day }) => day === start.day && box[1] <= b[1] + 0.05 && head <= box[3] + 0.05);
    const slot = inOneRow
      ? { startMin: start.time.startMin, endMin: end.time.endMin }
      : { startMin: headInRow ? start.time.startMin : hourAt(b[1], start.time.startMin), endMin: hourAt(b[3], end.time.endMin) };
    if (slot.endMin <= slot.startMin) { slot.startMin = start.time.startMin; slot.endMin = end.time.endMin; }
    const roomCell = adjoiningRoom ?? cells.find((other) => roomOnly.test(squash(other[4])) &&
      Math.abs(other[1] - b[3]) < 0.05 && Math.abs(other[0] - b[0]) < 0.05 &&
      Math.abs(other[2] - b[2]) < 0.05 && other[3] <= end.box[3] + 0.05);
    // "S1-S7" over a column: what is below it that day is held in those weeks only.
    const headed = weekHeadings.find(({ box }) => box[0] <= b[0] + 0.05 && box[2] >= b[2] - 0.05 && box[3] <= b[1] + 0.05 &&
      dayAt((box[1] + box[3]) / 2) === start.day)?.weeks ?? "all";
    const audience = new Map<number, Set<string>>();
    for (const c of covered) {
      const rules = audience.get(c.id) ?? new Set();
      rules.add(c.weeks ?? "all");
      audience.set(c.id, rules);
    }
    for (const activity of options.splitActivities?.(b[4]) ?? [b[4]]) {
      const parsed = parse(activity);
      const subgroups = options.splitActivities ? [...activity.matchAll(/\bsg\.\s*(\d+\s*\/\s*\d+)/gi)]
        .map((m) => m[1].replaceAll(" ", "")) : [];
      const time = activityTime(activity, slot);
      // "(s:1-8 2h, s:9-12 3h)": a lecture whose length changes is one entry per length.
      const loads = hourLoads(activity);
      for (const load of loads.length ? loads : [null]) {
        const byRule = new Map<string, number[]>();
        for (const [id, rules] of audience) {
          if (subgroups.length && !subgroups.includes(result.groups[id].name)) continue;
          if (options.isFor && !options.isFor(activity, result.groups[id])) continue;
          const parity = rules.size === 1 ? [...rules][0] : "all";
          const weeks = [...new Set([documentWeeks, load?.weeks ?? parsed.weeks, parity, headed].filter((w) => w !== "all"))].join("&") || "all";
          const ids = byRule.get(weeks) ?? [];
          ids.push(id);
          byRule.set(weeks, ids);
        }
        for (const [weeks, groups] of byRule) {
          result.entries.push({ sheet, day: start.day, startMin: time.startMin,
            // The length the timetable states wins over the box: "s:9-12 3h" in a two-hour row ends an hour later.
            endMin: load ? time.startMin + load.hours * 60 : time.endMin, groups, weeks,
            courseName: parsed.name, courseAbbr: parsed.abbr, kind: parsed.kind,
            room: parsed.room ?? (roomCell ? squash(roomCell[4]).replace(/^sal[aă]\s+/i, "") : null),
            teacher: parsed.teacher, rawText: squash(activity), isSlotOption: false,
            publishedOptional: isFacultative(activity) });
        }
      }
    }
  }
  return result;
}

/** Split only on cohort headings. Cell borders inside the body can separate rooms,
 * teachers or activities and do not establish additional student groups. */
export function headerColumns(
  headings: Box[], describe: (path: string[]) => NormalizedGroup | null,
): PrintedColumn[] {
  const edges = [...new Set(headings.flatMap((c) => [c[0], c[2]]))].sort((a, b) => a - b);
  return edges.slice(1).flatMap((right, i) => {
    const left = edges[i], x = (left + right) / 2;
    // A heading drawn a column too wide runs past the heading above it: "Grupa B" of one
    // programme also covers the first column of the next programme, whose "Grupa 2" starts a
    // column late. The line below shows it: its "sgr. 1" starts at the programme's edge and
    // runs under both. There, the heading beside the wide one applies, from the programme's edge on.
    const boxes: Box[] = [];
    for (const box of headings.filter((b) => b[0] <= x && b[2] > x).sort((a, b) => a[1] - b[1])) {
      const above = boxes.at(-1);
      const shared = above ? Math.min(box[2], above[2]) - Math.max(box[0], above[0]) : 0;
      const beside = above && shared < (box[2] - box[0]) / 2
        ? headings.find((h) => h !== box && Math.abs(h[1] - box[1]) < 0.05 && Math.abs(h[3] - box[3]) < 0.05 &&
            h[0] >= above[0] - 0.05 && h[2] <= above[2] + 0.05 &&
            (Math.abs(h[0] - box[2]) < 0.05 || Math.abs(h[2] - box[0]) < 0.05))
        : undefined;
      // The wide heading's edge that lies under the heading above, and that heading's own edge on the same side.
      const [inner, edge] = above && box[0] < above[0] - 0.05 ? [box[2], above[0]] : [box[0], above?.[2] ?? 0];
      const confirmed = beside && headings.some((h) => h[1] >= box[3] - 0.05 && h[0] <= x && h[2] > x &&
        h[0] < inner - 0.05 && h[2] > inner + 0.05 && (Math.abs(h[0] - edge) < 0.05 || Math.abs(h[2] - edge) < 0.05));
      boxes.push(beside && above && confirmed
        ? [Math.min(beside[0], Math.max(box[0], above[0])), beside[1], Math.max(beside[2], Math.min(box[2], above[2])), beside[3], beside[4]]
        : box);
    }
    const path = boxes.map((b) => squash(b[4]));
    const group = path.length ? describe(path) : null;
    if (!group) return [];
    const flag = path.find((s) => /^(?:s[aă]pt\.?\s*)?(?:impar|imapr|par)[aăe]?$/i.test(s));
    return [{ left, right, group, weeks: flag ? /im/i.test(flag) ? "odd" : "even" : undefined }];
  });
}
