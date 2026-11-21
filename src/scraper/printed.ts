import { hasKindMarker, parseCellText } from "./cellText";
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

const roomOnly = /^(?:sal[aă]\s+[\p{L}\d .-]{1,14}|(?:[A-Z]{1,3}\s?-?\d{2,4}[a-z]?|\d{2,4}[A-Z]{1,3}|Ca\d+|NM|PN|Vv))$/u;
const staffTitle = /(?:\b(?:asist|prof|conf|lect)\s*\.|[sșş](?:ef\s+lucr|\s*\.\s*l)\.)/i;
const continuation = /^(?:(?:\([CSLP]\)\s*)?(?:s[aă]pt\w*\.?\s*(?:\d+\s*[-–]\s*\d+|imp\w*|par\w*)|\([CSLP]\))\s*$|(?:asist|prof|conf|lect)\.|[sșş]ef\s+lucr)/i;

/** IEE prints the room first and the kind after the lecturer's name. */
export function electricalCell(input: string) {
  const raw = squash(input).replace(/^sg\.\s*\d+\s*\/\s*\d+\s*[,;]\s*/i, "");
  const room = /^(?:sal[aă]\s*((?:[A-Z]+\s*)?\d{2,4}[a-z]?)|([A-Z]\s?\d{2,4}[a-z]?|SPM\s*\d+))[\s,;]+(?=\S)/iu.exec(raw);
  const rest = room ? raw.slice(room[0].length) : raw;
  const title = staffTitle.exec(rest);
  const type = /\(\s*(C|S|L|P|curs|seminar|lab|laborator|proiect)\b[^)]*\)/i.exec(rest);
  const end = Math.min(title?.index ?? rest.length, type?.index ?? rest.length);
  const course = rest.slice(0, end).replace(/[,;\s]+$/, "");
  const parsed = parseCellText(type && course ? `${course} ${type[0]} ${rest.slice(end).replace(type[0], "")}` : rest);
  if (room) parsed.room = room[1] ?? room[2];
  if (title) parsed.teacher = rest.slice(title.index).split(/\s*\([CSLP]\)|\bs[aă]pt\.?|[,;]\s*(?:sala|[A-F]\d)/i)[0].replace(/[,;\s]+$/, "") || null;
  return parsed;
}

export function electricalActivities(text: string): string[] {
  const parts: string[] = [];
  for (const line of text.split(/\n/)) {
    const last = parts.at(-1);
    if (last && !(hasKindMarker(last) && hasKindMarker(line) && /(?:\bs\.|s[aă]pt\.?)\s*(?:imp|par)/i.test(last))) {
      parts[parts.length - 1] += "\n" + line;
    } else parts.push(line);
  }
  return parts;
}

/** Civil Engineering puts the room and lecturer on a second line below the title. */
const civilRoom = /^(?:[Ss]al[aă]\s+)?(LG\s*\d+|[A-Z]{1,3}\s?-?\d+[a-z]?|PN|NM|V[Vv]|\d+)\b\s*(.*)$/u;
export function civilDetail(text: string) { return civilRoom.test(squash(text)); }

export function civilCell(raw: string) {
  const lines = raw.trim().split(/\n+/).map(squash);
  const last = lines.at(-1) ?? "";
  const detail = civilRoom.exec(last);
  if (lines.length < 2 || !detail) return parseCellText(raw);
  const parsed = parseCellText(lines.slice(0, -1).join(" "));
  parsed.room = detail[1];
  if (detail[2]) parsed.teacher = detail[2];
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
  options: { splitSharedHours?: boolean; splitActivities?: (text: string) => string[]; isDetail?: (text: string) => boolean } = {},
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
  const aligned = new Map<string, Box>();
  const blocks: Box[] = [];
  const detailCell = (text: string) => roomOnly.test(text) || !!options.isDetail?.(text);
  for (const b of cells.filter((b) => b[1] >= first && indexed.some((c) => c.left < b[2] && c.right > b[0]))
    .sort((a, b) => a[1] - b[1])) {
    const key = b[0] + "|" + b[2];
    const above = aligned.get(key);
    const raw = squash(b[4]);
    if (above && (continuation.test(raw) || detailCell(raw)) && Math.abs(above[3] - b[1]) < 0.05
      && dayAt((above[1] + above[3]) / 2) === dayAt((b[1] + b[3]) / 2)
      && !parseTimeRange(above[4]) && !dayOf(above[4]) && !detailCell(squash(above[4]))) {
      above[4] += "\n" + b[4];
      above[3] = b[3];
    } else {
      const copy: Box = [...b];
      blocks.push(copy);
      aligned.set(key, copy);
    }
  }
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
    if (parseTimeRange(raw) || dayOf(raw) || /^[-–—.\s]+$/.test(raw) || detailCell(raw) || continuation.test(raw)) continue;
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
    const roomCell = adjoiningRoom ?? cells.find((other) => roomOnly.test(squash(other[4])) &&
      Math.abs(other[1] - b[3]) < 0.05 && Math.abs(other[0] - b[0]) < 0.05 &&
      Math.abs(other[2] - b[2]) < 0.05 && other[3] <= end.box[3] + 0.05);
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
      const byRule = new Map<string, number[]>();
      for (const [id, rules] of audience) {
        if (subgroups.length && !subgroups.includes(result.groups[id].name)) continue;
        const parity = rules.size === 1 ? [...rules][0] : "all";
        const weeks = [...new Set([documentWeeks, parsed.weeks, parity].filter((w) => w !== "all"))].join("&") || "all";
        const ids = byRule.get(weeks) ?? [];
        ids.push(id);
        byRule.set(weeks, ids);
      }
      for (const [weeks, groups] of byRule) {
        const time = activityTime(activity, { startMin: start.time.startMin, endMin: end.time.endMin });
        result.entries.push({ sheet, day: start.day, ...time, groups, weeks,
          courseName: parsed.name, courseAbbr: parsed.abbr, kind: parsed.kind,
          room: parsed.room ?? (roomCell ? squash(roomCell[4]).replace(/^sal[aă]\s+/i, "") : null),
          teacher: parsed.teacher, rawText: squash(activity), isSlotOption: false });
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
    const path = headings.filter((b) => b[0] <= x && b[2] > x)
      .sort((a, b) => a[1] - b[1]).map((b) => squash(b[4]));
    const group = path.length ? describe(path) : null;
    if (!group) return [];
    const flag = path.find((s) => /^(?:s[aă]pt\.?\s*)?(?:impar|imapr|par)[aăe]?$/i.test(s));
    return [{ left, right, group, weeks: flag ? /im/i.test(flag) ? "odd" : "even" : undefined }];
  });
}
