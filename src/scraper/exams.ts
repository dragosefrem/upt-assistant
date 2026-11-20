import type { Grid } from "./grid";
import { parseTimeRange, squash } from "./text";

/**
 * Parser for room-booking exam grids (used by AC, shared with ETcTI and IEE):
 * one sheet per session week, one column per room, one row per two-hour slot, with a
 * "Luni\n25.01.2027" row opening each day. A booked cell reads
 * "C-ro+TI 3\nAVD  C. Cernăzanu" — audience and year, then course and teacher.
 */
export interface RoomGridExam {
  date: string;
  startMin: number;
  endMin: number;
  room: string;
  audience: string;
  year: number | null;
  courseAbbr: string;
  detail: string;
  teacher: string | null;
  rawText: string;
}

const TEACHER_TAIL = /((?:\p{Lu}\.\s?){1,3}\s?\p{Lu}[\p{L}'’-]+(?:\s\p{Lu}[\p{L}'’-]+)?)\s*$/u;

export function parseRoomGridExams(grid: Grid): RoomGridExam[] {
  // Header row: "SALA" followed by one room per column.
  const header = grid.cells.find((c) => c.col === 1 && /^sal[aă]$/i.test(c.text.trim()));
  if (!header) return [];
  const rooms = new Map<number, string>();
  for (const cell of grid.cells) {
    if (cell.row === header.row && cell.col > 1) rooms.set(cell.col, squash(cell.text));
  }

  const exams: RoomGridExam[] = [];
  const open = new Map<number, RoomGridExam>();
  let date: string | null = null;

  for (let row = header.row + 1; row <= grid.rows; row++) {
    const lead = grid.textAt(row, 1);
    const dateMatch = /(\d{1,2})[./](\d{1,2})[./](\d{4})/.exec(lead);
    if (dateMatch) {
      date = `${dateMatch[3]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[1].padStart(2, "0")}`;
      open.clear();
      continue;
    }
    const time = parseTimeRange(lead);
    if (!time || !date) continue;

    for (const [col, room] of rooms) {
      const text = grid.textAt(row, col);
      const parsed = text ? parseExamCell(text) : null;
      const previous = open.get(col);
      if (!parsed) {
        open.delete(col);
        continue;
      }
      // The same booking repeated in the next slot is one longer exam.
      if (previous && previous.rawText === parsed.rawText && previous.endMin === time.startMin) {
        previous.endMin = time.endMin;
        continue;
      }
      const exam: RoomGridExam = { ...parsed, date, room, startMin: time.startMin, endMin: time.endMin };
      exams.push(exam);
      open.set(col, exam);
    }
  }
  return exams;
}

type CellFields = Pick<RoomGridExam, "audience" | "year" | "courseAbbr" | "detail" | "teacher" | "rawText">;

export function parseExamCell(text: string): CellFields | null {
  const rawText = squash(text.replace(/\n/g, " | "));
  const flat = squash(text.replace(/\n/g, " "));
  // Bare faculty codes mark which faculty owns the slot; "rez." marks other bookings.
  if (!/\s/.test(flat) || /\brez(?:ervat)?\b|\brez\./i.test(flat)) return null;

  const lines = text.split("\n").map(squash).filter(Boolean);
  let audienceLine = lines[0];
  let rest = lines.slice(1).join(" ");
  if (lines.length === 1) {
    const single = /^(\S+(?:\s*\+\s*\S+)*\s+\d)\s+(.+)$/.exec(flat);
    if (!single) return null;
    audienceLine = single[1];
    rest = single[2];
  }
  const aud = /^(.*?)[\s-]*(\d)\s*$/.exec(audienceLine);
  if (!aud || !rest) return null;

  let teacher: string | null = null;
  const t = TEACHER_TAIL.exec(rest);
  if (t) {
    teacher = squash(t[1]).replace(/\.(?=\p{L})/gu, ". ");
    rest = rest.slice(0, t.index);
  }
  const tokens = squash(rest).split(" ").filter(Boolean);
  if (!tokens.length) return null;
  return {
    audience: squash(aud[1]),
    year: +aud[2],
    courseAbbr: tokens[0],
    detail: tokens.slice(1).join(" "),
    teacher,
    rawText,
  };
}
