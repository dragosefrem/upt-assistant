import * as cheerio from "cheerio";
import { classifyLink } from "../discover";
import { headerColumns, readPrintedTable, type Box } from "../printed";
import { parseTimetable } from "../timetable";
import { norm, parseStudyYear, squash } from "../text";
import type { FacultyAdapter, SpecRef } from "../types";
import { genericNormalize } from "./generic";

/**
 * A seminar and a lab of the same course can share a cell, each in its own weeks and the lab
 * for one semigroup only: "Fizica (S) sapt. impare Sala N206 Fizica (L) sapt. pare (gr 1.1)
 * Sala C303a". Read as one activity it was a seminar every week, and the lab did not exist.
 */
export function roboticsActivities(text: string): string[] {
  const flat = squash(text);
  const first = /^(.+?)\s*\(([CSLP])\)/.exec(flat);
  if (!first) return [text];
  const course = first[1].trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const again = new RegExp(`\\s${course}\\s*\\((?!${first[2]}\\))[CSLP]\\)`, "u").exec(flat.slice(first[0].length));
  if (!again) return [text];
  const cut = first[0].length + again.index;
  return [flat.slice(0, cut).trim(), flat.slice(cut).trim()];
}

/** "(gr 1.1)" is semigroup 1 of group 1, which the sheet's columns call "Grupa 1" and "1/1". */
export function roboticsAudience(activity: string, group: { name: string }): boolean {
  const named = /\(\s*gr\.?\s*(\d)\s*[./]\s*(\d)\s*\)/i.exec(activity);
  return !named || new RegExp(`(?:^|\\D)${named[1]}\\s*/\\s*${named[2]}$`).test(group.name.trim());
}

export const riaAdapter: FacultyAdapter = {
  slug: "facultatea-de-robotica-inteligenta-artificiala-si-sisteme-autonome",
  timetablePages: (_semester, url) => [url ?? "https://ria.upt.ro/studenti/orare/"],
  timetableSources(html, url) {
    const $ = cheerio.load(html);
    return $("main li a[href]").toArray().flatMap((el) => {
      const a = $(el), context = squash(a.closest("ul").prev().text());
      if (!/semestr/i.test(context)) return [];
      const guess = classifyLink({ label: squash(a.text()), url: new URL(a.attr("href")!, url).href, context }, "timetable");
      return guess?.format === "xlsx" ? [guess] : [];
    });
  },
  parseGrid(grid, source) {
    const year = parseStudyYear(grid.name);
    if (!year) return null;
    const sheet = norm(grid.name), master = sheet.includes("master");
    let name = source.label, language = "RO";
    if (sheet.includes("smii4")) name = "Sisteme mecatronice inteligente pentru industry 4.0";
    else if (sheet.includes("sria")) name = "Sisteme robotice cu inteligenţă artificială";
    else if (sheet.includes("drone")) { name = "Ingineria dronelor și informatică aeronautică"; language = "EN"; }
    else if (sheet.includes("dual")) name = "Robotică, învățământ dual";
    else if (sheet.includes("mecatronica si robotica")) name = "Mecatronică și robotică";
    else if (sheet.includes("robotica")) name = "Robotică";
    else if (sheet.includes("mecatronica")) name = "Mecatronică";
    const spec: SpecRef = { name, language, degree: master ? "master" : "bachelor" };
    if (/^inf\b/.test(sheet) || norm(name) === "tehnologii informatice") {
      return genericNormalize(parseTimetable(grid), source, { year, spec: () => spec, series: () => "" });
    }
    const cells: Box[] = grid.cells.map((c) => [c.col, c.row, c.col + c.colSpan, c.row + c.rowSpan, c.text]);
    return readPrintedTable(cells, grid.name, (header, left) => {
      const headings = header.filter((b) => b[0] >= left &&
        /^(?:(?:semi)?grupa|sgr\.|\d\s*\/\s*\d|(?:s[aă]pt\.?\s*)?(?:impar|imapr|par)[aăe]?$)/i.test(squash(b[4])));
      if (!headings.length) return [{ left, right: left + 1, group: { spec, year, series: "", name: "" } }];
      return headerColumns(headings, (path) => ({
        spec: path.some((s) => /dual/i.test(s)) ? { ...spec, name: "Robotică, învățământ dual" } : spec,
        year, series: "", name: path.filter((s) => /^(?:gr|semi|sgr|\d)/i.test(s)).join(" "),
      }));
    }, "all", undefined, { splitActivities: roboticsActivities, isFor: roboticsAudience });
  },
};
