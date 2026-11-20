import type { EntryKind } from "@/db/schema";
import { hasKindMarker, parseCellText } from "./cellText";
import type { Grid, GridCell } from "./grid";
import {
  DAY_IN_TEXT,
  acronym,
  norm,
  parseDayWord,
  parseStudyYear,
  parseTimeRange,
  squash,
  type TimeRange,
} from "./text";

/**
 * Generic parser for the grid timetables UPT faculties publish: one row per hour,
 * one column per (sub)group, merged cells for activities shared between groups.
 *
 * Nothing here is faculty-specific. Layout is discovered from the sheet itself:
 * the hour column, the day blocks, the header rows that name tracks and groups, and
 * any free-text "pick a slot" column on the side.
 */

export interface ParsedGroup {
  /** Header above the group: a specialization ("CALCULATOARE (C)") or a series. */
  track: string | null;
  name: string;
  col: number;
}

export interface ParsedEntry {
  day: number;
  startMin: number;
  endMin: number;
  kind: EntryKind;
  courseName: string;
  courseAbbr: string | null;
  room: string | null;
  teacher: string | null;
  weeks: string;
  rawText: string;
  /** Indexes into `ParsedTimetable.groups`. */
  groups: number[];
  /** One of several alternative slots for the same activity. */
  isSlotOption: boolean;
}

export interface ParsedTimetable {
  sheet: string;
  title: string;
  year: number | null;
  groups: ParsedGroup[];
  entries: ParsedEntry[];
  warnings: string[];
}

const TITLE_RE = /\b(anul|semestr\w*|sem\.?|year|semester|orar|20\d\d)\b/i;
const SIDE_HEADER_RE = /laborato|op[tţț]ional|ore comune|suplimentar|observa|not[aăe]\b/i;
const LEGEND_RE = /denumire|nr\.?\s*ore|titular|nume si prenume|link curs|cvupt|consulta[tţț]i/i;
const CONTINUATION_RE =
  /^\s*(?:sal[aă]|ala|amf|amfiteatru|room|s[aă]pt|weeks?|online|\d+\s*h\s*\/)/i;
/** A cell holding nothing but a room code ("B418a", "SPM 205"). */
const BARE_ROOM_RE = /^(?:[A-Z]{1,4}\s?\d{1,4}[A-Za-z]?|\d{2,4}\s?[A-Z]{1,4})$/;

interface TimeRow {
  row: number;
  day: number;
  time: TimeRange;
}

type Column =
  | { type: "group"; index: number }
  | { type: "side" }
  | { type: "skip" };

function countDayTimeRefs(text: string): number {
  const days = text.match(DAY_IN_TEXT)?.length ?? 0;
  const times = text.match(/\b\d{1,2}\s*[-–]\s*\d{1,2}\b/g)?.length ?? 0;
  return Math.min(days, times);
}

function cleanGroupLabel(label: string): string {
  return squash(label.replace(/^\s*(?:sub|semi|s)?(?:grupa|gr|sg)\b\.?\s*/i, "")) || squash(label);
}

export function parseTimetable(grid: Grid, opts: { yearHint?: number | null } = {}): ParsedTimetable {
  const warnings: string[] = [];
  const out: ParsedTimetable = {
    sheet: grid.name,
    title: "",
    year: opts.yearHint ?? null,
    groups: [],
    entries: [],
    warnings,
  };

  /* ── 1. Hour column ── */
  const timeCounts = new Map<number, number>();
  for (const cell of grid.cells) {
    if (cell.colSpan === 1 && parseTimeRange(cell.text)) {
      timeCounts.set(cell.col, (timeCounts.get(cell.col) ?? 0) + 1);
    }
  }
  const timeCols = [...timeCounts].filter(([, n]) => n >= 4).map(([c]) => c).sort((a, b) => a - b);
  if (!timeCols.length) {
    warnings.push("No hour column found — this sheet is not a timetable grid.");
    return out;
  }
  const timeCol = timeCols[0];

  /* ── 2. Hour rows and day blocks ── */
  const timeRows: TimeRow[] = [];
  let day = 0;
  let prevStart = Number.POSITIVE_INFINITY;
  for (let row = 1; row <= grid.rows; row++) {
    const time = parseTimeRange(grid.textAt(row, timeCol));
    if (!time) continue;
    let explicit: number | null = null;
    for (let col = 1; col < timeCol; col++) {
      const cell = grid.at(row, col);
      if (cell && cell.row === row) explicit ??= parseDayWord(cell.text);
    }
    if (explicit) {
      day = explicit;
    } else if (time.startMin <= prevStart) {
      // Hours wrapped around: a new day starts. Sheets that label days explicitly
      // still fall back to this when a label is missing.
      day = day === 0 ? 1 : day + 1;
    }
    prevStart = time.startMin;
    timeRows.push({ row, day, time });
  }
  if (timeRows.some((t) => t.day > 7)) {
    warnings.push("More than seven day blocks detected; later blocks were ignored.");
  }
  const rowInfo = new Map(timeRows.map((t) => [t.row, t]));
  const firstTimeRow = timeRows[0].row;
  const lastTimeRow = timeRows[timeRows.length - 1].row;

  /* ── 3. Column roles ── */
  const repeated = new Set<number>(timeCols.slice(1));
  // Columns that only ever hold day names (repeated day labels) carry no activities.
  const colTexts = new Map<number, string[]>();
  for (const cell of grid.cells) {
    if (cell.row < firstTimeRow || cell.row > lastTimeRow) continue;
    const list = colTexts.get(cell.col) ?? [];
    list.push(cell.text);
    colTexts.set(cell.col, list);
  }
  for (const [col, texts] of colTexts) {
    if (col > timeCol && texts.every((t) => parseDayWord(t) !== null)) repeated.add(col);
  }

  // Header cells above the grid, excluding the sheet title.
  const headerCells = grid.cells.filter((c) => c.row < firstTimeRow && c.col + c.colSpan - 1 > timeCol);
  const titleCells = headerCells.filter(
    (c) => TITLE_RE.test(c.text) && !/^\s*(?:sub)?(?:grupa|gr|sg)\b/i.test(c.text) && !SIDE_HEADER_RE.test(c.text),
  );
  out.title = squash(
    (titleCells.length ? titleCells : grid.cells.filter((c) => c.row < firstTimeRow).slice(0, 1))
      .map((c) => c.text)
      .join(" · "),
  );
  out.year ??= parseStudyYear(out.title) ?? parseStudyYear(grid.name);

  const titleSet = new Set(titleCells);
  const labelCells = headerCells.filter((c) => !titleSet.has(c) && !parseTimeRange(c.text));
  const headerAt = (col: number): GridCell[] =>
    labelCells
      .filter((c) => c.col <= col && col < c.col + c.colSpan)
      .sort((a, b) => a.row - b.row);

  // When the sheet labels its groups recognisably ("1.1", "gr. 2", "sg.3.1"), only those
  // columns are groups; other headed columns (legends, staff lists) are not.
  const GROUP_LIKE = /^\s*(?:(?:sub|semi|s)?(?:grupa|gr|sg)\b|\d{1,2}(?:\.\d{1,2})?[a-z]?\s*$|on\s?line)/i;
  const strictGroups = labelCells.filter((c) => GROUP_LIKE.test(c.text)).length >= 2;

  // Everything from a "Legenda" column rightwards explains the sheet; it is not data.
  const legendCol = Math.min(
    ...grid.cells.filter((c) => c.col > timeCol && /^\s*legend[aă]?\s*:?\s*$/i.test(c.text)).map((c) => c.col),
    Number.POSITIVE_INFINITY,
  );

  const columns = new Map<number, Column>();
  let lastTrack: string | null = null;
  let maxGroupCol = timeCol;
  const groupLabelCount = new Map<string, number>();
  for (let col = timeCol + 1; col <= grid.cols; col++) {
    if (repeated.has(col) || col >= legendCol) {
      columns.set(col, { type: "skip" });
      continue;
    }
    const stack = headerAt(col);
    if (!stack.length) continue;
    // A course legend or staff list next to the grid ends the group columns.
    if (stack.some((c) => LEGEND_RE.test(c.text))) break;
    const label = stack[stack.length - 1];
    if (SIDE_HEADER_RE.test(label.text)) {
      columns.set(col, { type: "side" });
      continue;
    }
    // Purely numeric cells in header rows are seat counts, not groups.
    if (/^\d{2,}$/.test(label.text.trim())) continue;
    if (strictGroups && !GROUP_LIKE.test(label.text)) continue;
    // The track is the widest header above the label (a specialization or series
    // spanning its groups); narrower cells in between only repeat the group number.
    const labelIsGroup = GROUP_LIKE.test(label.text);
    const above = stack.filter(
      (c) =>
        c !== label &&
        c.row < label.row &&
        (c.colSpan > label.colSpan ||
          // A programme with a single group: its heading is exactly as wide as "1.1".
          (labelIsGroup && c.colSpan === label.colSpan && c.row === label.row - 1)),
    );
    const top = above.sort((a, b) => b.colSpan - a.colSpan || b.row - a.row)[0];
    const track = top ? squash(top.text) : lastTrack;
    if (top) lastTrack = squash(top.text);
    let name = cleanGroupLabel(label.text);
    if (label.colSpan > 1 && !labelIsGroup) {
      // A wide heading that is not a group number ("Cursuri", a programme code) covers
      // one cohort: all of its columns belong to the same group.
      const first = columns.get(label.col);
      if (col > label.col && first?.type === "group") {
        columns.set(col, first);
        maxGroupCol = col;
        continue;
      }
      if (/^(cursuri|courses|lectures)$/i.test(name)) name = "";
    } else if (label.colSpan > 1) {
      name = `${name}.${col - label.col + 1}`;
    }
    const dedupeKey = `${track ?? ""}|${name}`;
    const seen = groupLabelCount.get(dedupeKey) ?? 0;
    groupLabelCount.set(dedupeKey, seen + 1);
    if (seen > 0) name = `${name} (${seen + 1})`;
    columns.set(col, { type: "group", index: out.groups.length });
    out.groups.push({ track, name, col });
    maxGroupCol = col;
  }

  const bodyCells = grid.cells.filter(
    (c) => c.row >= firstTimeRow && c.row <= lastTimeRow && c.col > timeCol && !repeated.has(c.col),
  );

  if (!out.groups.length) {
    // Sheets for a single cohort (most master's programmes) have no group header:
    // activity columns form one implicit group, text-with-times columns are notes.
    const stats = new Map<number, { refs: number; cells: number }>();
    for (const cell of bodyCells) {
      const s = stats.get(cell.col) ?? { refs: 0, cells: 0 };
      s.cells++;
      if (countDayTimeRefs(cell.text) > 0) s.refs++;
      stats.set(cell.col, s);
    }
    out.groups.push({ track: null, name: "", col: timeCol + 1 });
    for (const [col, s] of stats) {
      if (s.refs > 0 && s.refs / s.cells >= 0.25) columns.set(col, { type: "side" });
      else columns.set(col, { type: "group", index: 0 });
    }
    // Merged lecture cells may start in one activity column and cover the next.
    for (let col = timeCol + 1; col <= grid.cols; col++) {
      if (!columns.has(col) && !repeated.has(col)) columns.set(col, { type: "group", index: 0 });
    }
  } else {
    // Unlabelled columns to the right of the last group hold free-text notes.
    for (const cell of bodyCells) {
      if (cell.col > maxGroupCol && !columns.has(cell.col) && !headerAt(cell.col).some((c) => LEGEND_RE.test(c.text))) {
        columns.set(cell.col, { type: "side" });
      }
    }
  }

  /* ── 4. Stitch continuation rows ("sala 303CP" typed under the lecture) ── */
  interface Block {
    cell: GridCell;
    text: string;
    rowSpan: number;
  }
  const sorted = [...bodyCells].sort((a, b) => a.col - b.col || a.row - b.row);
  const blocks: Block[] = [];
  const blockByStart = new Map<string, Block>();
  for (const cell of sorted) {
    const role = columns.get(cell.col);
    const above = [...blocks]
      .reverse()
      .find(
        (b) =>
          b.cell.col === cell.col &&
          b.cell.colSpan === cell.colSpan &&
          b.cell.row + b.rowSpan === cell.row,
      );
    const sameDay =
      above && rowInfo.get(above.cell.row)?.day === rowInfo.get(cell.row)?.day && rowInfo.has(cell.row);
    if (
      above &&
      sameDay &&
      role?.type !== "side" &&
      !hasKindMarker(cell.text) &&
      (CONTINUATION_RE.test(cell.text) || BARE_ROOM_RE.test(cell.text.trim()))
    ) {
      above.text = `${above.text}\n${cell.text}`;
      above.rowSpan += cell.rowSpan;
      continue;
    }
    const block = { cell, text: cell.text, rowSpan: cell.rowSpan };
    blocks.push(block);
    blockByStart.set(`${cell.row}:${cell.col}`, block);
  }

  /* ── 5. Grid cells → entries ── */
  const sideBlocks: Array<{ blocks: Block[] }> = [];
  const sideByCol = new Map<number, { blocks: Block[] }>();

  for (const block of blocks) {
    const { cell } = block;
    const role = columns.get(cell.col);
    if (role?.type === "side") {
      let bucket = sideByCol.get(cell.col);
      if (!bucket) {
        bucket = { blocks: [] };
        sideByCol.set(cell.col, bucket);
        sideBlocks.push(bucket);
      }
      bucket.blocks.push(block);
      continue;
    }
    const groupIdx = new Set<number>();
    for (let col = cell.col; col < cell.col + cell.colSpan; col++) {
      const r = columns.get(col);
      if (r?.type === "group") groupIdx.add(r.index);
    }
    if (!groupIdx.size) continue;
    const start = rowInfo.get(cell.row);
    if (!start || start.day < 1 || start.day > 7) continue;
    let end = start;
    for (let row = cell.row; row < cell.row + block.rowSpan; row++) {
      const info = rowInfo.get(row);
      if (info && info.day === start.day) end = info;
    }
    const text = squash(block.text);
    if (/^[-–—.~]+$/.test(text)) continue;
    const parsed = parseCellText(block.text);
    out.entries.push({
      day: start.day,
      startMin: start.time.startMin,
      endMin: end.time.endMin,
      kind: parsed.kind,
      courseName: parsed.name,
      courseAbbr: parsed.abbr,
      room: parsed.room,
      teacher: parsed.teacher,
      weeks: parsed.weeks,
      rawText: text,
      groups: [...groupIdx].sort((a, b) => a - b),
      isSlotOption: false,
    });
  }

  /* ── 6. Side column: "PW (l) [C] sala B528b Marti 12-14, sala B515 Vineri 10-12" ── */
  for (const bucket of sideBlocks) {
    const ordered = bucket.blocks.sort((a, b) => a.cell.row - b.cell.row);
    let current: { text: string; startRow: number; endRow: number } | null = null;
    const notes: Array<{ text: string; startRow: number; endRow: number }> = [];
    for (const block of ordered) {
      const adjacent = current && block.cell.row <= current.endRow + 1;
      if (hasKindMarker(block.text) || !current || !adjacent) {
        if (current) notes.push(current);
        current = {
          text: block.text,
          startRow: block.cell.row,
          endRow: block.cell.row + block.rowSpan - 1,
        };
      } else {
        current.text += `\n${block.text}`;
        current.endRow = block.cell.row + block.rowSpan - 1;
      }
    }
    if (current) notes.push(current);
    for (const { text: note, startRow, endRow } of notes) {
      const slots = parseSlotNote(note);
      if (!slots) continue;
      if (!slots.slots.length) {
        // No day or hour in the text: the note's position in the grid is the slot.
        const start = rowInfo.get(startRow);
        if (start && start.day >= 1 && start.day <= 7) {
          let end = start;
          for (let row = startRow; row <= endRow; row++) {
            const info = rowInfo.get(row);
            if (info && info.day === start.day) end = info;
          }
          slots.slots.push({
            day: start.day,
            startMin: start.time.startMin,
            endMin: end.time.endMin,
            room: slots.room,
          });
        }
      }
      const wanted = slots.tracks.map((t) => norm(t));
      let groupIdx = out.groups.map((_, i) => i);
      if (wanted.length) {
        const filtered = groupIdx.filter((i) => {
          const track = out.groups[i].track ?? "";
          const code = /\(([^)]+)\)/.exec(track)?.[1] ?? acronym(track);
          return wanted.includes(norm(code)) || wanted.includes(norm(track));
        });
        if (filtered.length) groupIdx = filtered;
      }
      if (!slots.slots.length) {
        warnings.push(`Note without a recognisable time slot: "${squash(note).slice(0, 80)}"`);
        continue;
      }
      for (const slot of slots.slots) {
        out.entries.push({
          day: slot.day,
          startMin: slot.startMin,
          endMin: slot.endMin,
          kind: slots.kind,
          courseName: slots.name,
          courseAbbr: slots.abbr,
          room: slot.room,
          teacher: slots.teacher,
          weeks: slots.weeks,
          rawText: squash(note),
          groups: groupIdx,
          isSlotOption: slots.slots.length > 1,
        });
      }
    }
  }

  resolveCourseNames(out);
  if (!out.entries.length) warnings.push("The grid was recognised but contains no activities.");
  return out;
}

interface SlotNote {
  name: string;
  abbr: string | null;
  kind: EntryKind;
  teacher: string | null;
  room: string | null;
  weeks: string;
  tracks: string[];
  slots: Array<{ day: number; startMin: number; endMin: number; room: string | null }>;
}

/** Parses a free-text list of alternative time slots for one activity. */
export function parseSlotNote(note: string): SlotNote | null {
  const text = squash(note.replace(/\n/g, " ; "));
  if (!hasKindMarker(text)) return null;

  const tracks = /\[([^\]]+)\]/.exec(text)?.[1].split(/[+,/]/).map((s) => s.trim()).filter(Boolean) ?? [];
  const withoutTracks = text.replace(/\[[^\]]*\]/g, " ");

  // The head (name, type, maybe a teacher) ends where rooms/days/times begin.
  const firstRef = withoutTracks.search(
    new RegExp(`${DAY_IN_TEXT.source}|\\bsal[aă]\\b|\\broom\\b|;`, "i"),
  );
  const head = parseCellText(firstRef > 0 ? withoutTracks.slice(0, firstRef) : withoutTracks);
  const body = withoutTracks;

  type Token =
    | { type: "room"; value: string; pos: number }
    | { type: "day"; value: number; pos: number }
    | { type: "time"; startMin: number; endMin: number; pos: number };
  const tokens: Token[] = [];
  for (const m of body.matchAll(/(?:\bsal[aă]|\broom)\s*:?\s*([\p{L}\d]+(?:\s\d{1,4}\b)?)/giu)) {
    tokens.push({ type: "room", value: m[1].trim(), pos: m.index });
  }
  for (const m of body.matchAll(new RegExp(DAY_IN_TEXT.source, "gi"))) {
    const d = parseDayWord(m[0]);
    if (d) tokens.push({ type: "day", value: d, pos: m.index });
  }
  for (const m of body.matchAll(/(?<![\d.])(\d{1,2})\s*[-–]\s*(\d{1,2})(?![\d.]|\s*s[aă]pt)/g)) {
    const a = +m[1];
    const b = +m[2];
    if (a >= 7 && b <= 22 && b > a) tokens.push({ type: "time", startMin: a * 60, endMin: b * 60, pos: m.index });
  }
  tokens.sort((a, b) => a.pos - b.pos);

  const times = tokens.filter((t) => t.type === "time");
  const rooms = tokens.filter((t) => t.type === "room");
  // "sala B515 Vineri 10-12" names the room first; "Tue 12-14 room B414" names it last.
  const roomFirst = !rooms.length || !times.length || rooms[0].pos < times[0].pos;

  const slots: SlotNote["slots"] = [];
  let currentDay: number | null = null;
  let currentRoom: string | null = roomFirst ? null : head.room;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token.type === "day") currentDay = token.value;
    else if (token.type === "room") currentRoom = token.value;
    else if (currentDay) {
      let room = currentRoom;
      if (!roomFirst) {
        const next = tokens.slice(i + 1).find((t) => t.type === "room");
        room = next && next.type === "room" ? next.value : currentRoom;
      }
      slots.push({ day: currentDay, startMin: token.startMin, endMin: token.endMin, room: room ?? head.room });
    }
  }

  return {
    name: head.name,
    abbr: head.abbr,
    kind: head.kind,
    teacher: head.teacher,
    room: head.room ?? (rooms[0]?.type === "room" ? rooms[0].value : null),
    weeks: parseCellText(withoutTracks).weeks,
    tracks,
    slots,
  };
}

/**
 * Labs are written as acronyms ("SO2 (l)") while lectures carry the full name. Map each
 * acronym back to its lecture so both end up under the same course.
 */
function resolveCourseNames(t: ParsedTimetable) {
  const key = (s: string) => norm(s).replace(/ /g, "");
  // Acronyms ("SO2") and clipped single words ("Fiz") both stand for a longer name.
  const isAcronymOnly = (e: ParsedEntry) =>
    (!!e.courseAbbr && key(e.courseAbbr) === key(e.courseName)) ||
    (!/\s/.test(e.courseName.trim()) && key(e.courseName).length <= 4);

  const byAcronym = new Map<string, string>();
  const fullNames = new Set<string>();
  for (const e of t.entries) {
    if (isAcronymOnly(e)) continue;
    fullNames.add(e.courseName);
    if (e.courseAbbr) byAcronym.set(key(e.courseAbbr), e.courseName);
    const auto = key(acronym(e.courseName));
    if (auto.length >= 2 && !byAcronym.has(auto)) byAcronym.set(auto, e.courseName);
  }

  const resolve = (abbr: string): string | null => {
    const k = key(abbr);
    const exact = byAcronym.get(k);
    if (exact) return exact;
    // "Fiz" → "Fizica", "ET" → "Electrotehnica": accept only an unambiguous match.
    const candidates = [...fullNames].filter((name) => {
      const n = key(name);
      if (k.length >= 3 && n.startsWith(k)) return true;
      if (!/\s/.test(name.trim()) && n[0] === k[0] && k.length >= 2) {
        let i = 0;
        for (const ch of n) if (ch === k[i]) i++;
        return i === k.length;
      }
      return false;
    });
    return candidates.length === 1 ? candidates[0] : null;
  };

  for (const e of t.entries) {
    if (isAcronymOnly(e)) {
      const short = e.courseAbbr ?? e.courseName;
      const full = resolve(short);
      if (full) {
        e.courseName = full;
        e.courseAbbr = short;
      }
      continue;
    }
    if (!e.courseAbbr) {
      const auto = acronym(e.courseName);
      e.courseAbbr = auto.length >= 2 ? auto : null;
    }
  }
}
