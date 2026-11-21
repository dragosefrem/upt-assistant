import * as cheerio from "cheerio";
import { classifyLink } from "../discover";
import { headerColumns, readPrintedTable, type Box } from "../printed";
import { parseTimetable } from "../timetable";
import { norm, parseStudyYear, squash } from "../text";
import type { FacultyAdapter, SpecRef } from "../types";
import { genericNormalize } from "./generic";

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
    });
  },
};
