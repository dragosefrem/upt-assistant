import ExcelJS from "exceljs";
import * as cheerio from "cheerio";
import { squash } from "./text";

/**
 * A spreadsheet reduced to what timetable parsing needs: text plus merged regions.
 * Both Excel workbooks and published Google Sheets (HTML tables) load into this shape,
 * so every parser works on either.
 */
export interface GridCell {
  /** 1-based position of the top-left corner. */
  row: number;
  col: number;
  rowSpan: number;
  colSpan: number;
  text: string;
}

export class Grid {
  private readonly owner = new Map<string, GridCell>();
  readonly cells: GridCell[] = [];
  rows = 0;
  cols = 0;

  constructor(readonly name: string) {}

  add(cell: GridCell) {
    const text = cell.text.replace(/\r/g, "").trim();
    if (!text) return;
    const stored = { ...cell, text };
    this.cells.push(stored);
    for (let r = cell.row; r < cell.row + cell.rowSpan; r++)
      for (let c = cell.col; c < cell.col + cell.colSpan; c++) this.owner.set(`${r}:${c}`, stored);
    this.rows = Math.max(this.rows, cell.row + cell.rowSpan - 1);
    this.cols = Math.max(this.cols, cell.col + cell.colSpan - 1);
  }

  /** The (possibly merged) cell covering a position, or null when empty. */
  at(row: number, col: number): GridCell | null {
    return this.owner.get(`${row}:${col}`) ?? null;
  }

  /** Text of the cell whose top-left corner is exactly here (ignores merge coverage). */
  textAt(row: number, col: number): string {
    const cell = this.at(row, col);
    return cell && cell.row === row && cell.col === col ? cell.text : "";
  }
}

function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("richText" in value) return value.richText.map((r) => r.text).join("");
    if ("result" in value) return cellText(value.result as ExcelJS.CellValue);
    if ("text" in value) return String(value.text);
    if ("error" in value) return "";
    return "";
  }
  return String(value);
}

function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

function parseRange(range: string) {
  const m = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(range);
  if (!m) return null;
  return { top: +m[2], left: colIndex(m[1]), bottom: +m[4], right: colIndex(m[3]) };
}

/** Number of visible rows or columns up to and including each worksheet index. */
function visibleCounts(length: number, hidden: (index: number) => boolean | undefined) {
  const counts = new Uint32Array(length + 1);
  for (let i = 1; i <= length; i++) counts[i] = counts[i - 1] + (hidden(i) ? 0 : 1);
  return counts;
}

function isSpacer(column: ExcelJS.Column): boolean {
  if (column.hidden || column.width === undefined || column.width >= 1) return column.hidden;
  // AC retains an old master's timetable inside a sub-character-width black divider.
  // A narrow column with legible text (e.g. a vertical weekday) is still part of the grid.
  let masked = false, legible = false;
  column.eachCell((cell) => {
    if (cell.master !== cell || !cellText(cell.value)) return;
    const fill = cell.fill;
    if (fill?.type !== "pattern" || fill.pattern !== "solid" || !fill.fgColor?.argb ||
        cell.font?.color?.argb !== fill.fgColor.argb) legible = true;
    else masked = true;
  });
  return masked && !legible;
}

export async function loadWorkbook(data: Buffer): Promise<Grid[]> {
  const workbook = new ExcelJS.Workbook();
  // exceljs types predate Node's generic Buffer; the runtime accepts any Buffer.
  await workbook.xlsx.load(data as unknown as ExcelJS.Buffer);
  const grids: Grid[] = [];
  for (const sheet of workbook.worksheets) {
    if (sheet.state !== "visible") continue;
    const grid = new Grid(sheet.name);
    const rows = visibleCounts(sheet.rowCount, (i) => sheet.findRow(i)?.hidden);
    const cols = visibleCounts(sheet.columnCount, (i) => isSpacer(sheet.getColumn(i)));
    const merges = new Map<string, { bottom: number; right: number }>();
    for (const ref of (sheet.model as { merges?: string[] }).merges ?? []) {
      const r = parseRange(ref);
      if (r) merges.set(`${r.top}:${r.left}`, r);
    }
    sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
        if (cell.master !== cell) return;
        const merge = merges.get(`${rowNumber}:${colNumber}`);
        // A merge can start in a hidden column and still cover visible groups.
        const rowsBefore = rows[rowNumber - 1], colsBefore = cols[colNumber - 1];
        const rowSpan = rows[merge?.bottom ?? rowNumber] - rowsBefore;
        const colSpan = cols[merge?.right ?? colNumber] - colsBefore;
        if (rowSpan && colSpan) {
          grid.add({ row: rowsBefore + 1, col: colsBefore + 1, rowSpan, colSpan, text: cellText(cell.value) });
        }
      });
    });
    grids.push(grid);
  }
  return grids;
}

/**
 * Loads every `<table>` of an HTML document as a grid, honouring rowspan/colspan.
 * Google's "publish to web" pages wrap each sheet in one table and prefix rows with a
 * `<th>` row number, which is skipped.
 */
export function loadHtmlTables(html: string, fallbackName = "Sheet"): Grid[] {
  const $ = cheerio.load(html);
  const sheetNames = $("#sheet-menu li a")
    .map((_, a) => squash($(a).text()))
    .get();
  const grids: Grid[] = [];
  $("table").each((index, table) => {
    const grid = new Grid(sheetNames[index] ?? `${fallbackName} ${index + 1}`);
    const taken = new Set<string>();
    let rowNumber = 0;
    $(table)
      .find("tr")
      .each((_, tr) => {
        const tds = $(tr).children("td");
        if (!tds.length) return;
        rowNumber++;
        let col = 1;
        tds.each((__, td) => {
          while (taken.has(`${rowNumber}:${col}`)) col++;
          const rowSpan = Math.max(1, Number($(td).attr("rowspan")) || 1);
          const colSpan = Math.max(1, Number($(td).attr("colspan")) || 1);
          $(td).find("br").replaceWith("\n");
          const text = $(td).text().replace(/ /g, " ");
          for (let r = rowNumber; r < rowNumber + rowSpan; r++)
            for (let c = col; c < col + colSpan; c++) taken.add(`${r}:${c}`);
          grid.add({ row: rowNumber, col, rowSpan, colSpan, text });
          col += colSpan;
        });
      });
    if (grid.cells.length) grids.push(grid);
  });
  return grids;
}
