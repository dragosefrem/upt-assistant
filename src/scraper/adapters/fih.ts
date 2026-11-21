import * as cheerio from "cheerio";
import type { EntryKind } from "@/db/schema";
import { detectAcademicYear, detectSemester } from "../discover";
import { parseDayWord, parseTimeRange, squash } from "../text";
import type { FacultyAdapter, NormalizedEntry } from "../types";

const programmes: Record<string, string> = {
  IEC: "Inginerie electrică și calculatoare", IIND: "Informatică industrială",
  IIDI: "Ingineria Internetului Dispozitivelor Inteligente", AR: "Autovehicule rutiere",
  IMAN: "Inginerie și management", IVD: "Ingineria valorificării deșeurilor",
  IEDM: "Inginerie economică în domeniul mecanic",
  IEICM: "Inginerie economică în industria chimică și de materiale",
  TIIE: "Tehnici informatice în ingineria electrică",
  IMDDIM: "Ingineria și managementul dezvoltării durabile în industria de materiale",
  IMSM: "Ingineria și managementul sistemelor mecanice",
};
const kinds: Record<string, EntryKind> = { C: "course", S: "seminar", L: "lab", P: "project" };

export const fihAdapter: FacultyAdapter = {
  slug: "facultatea-de-inginerie-din-hunedoara",
  timetablePages(semester, url) {
    return url ? [`${url.split("?")[0]}?sem=${semester.academicYear.slice(0, 4)}${semester.number}`] : [];
  },
  timetableSources(html, url, semester) {
    const $ = cheerio.load(html);
    const selected = $("#sem option[selected]");
    const context = selected.text();
    if (detectAcademicYear(context) !== semester.academicYear || detectSemester(context) !== semester.number) return [];
    return $("#grupa option").toArray().flatMap((el) => {
      const id = $(el).attr("value");
      const label = squash($(el).text());
      if (!id || !/^[LM][1-6] \S+$/.test(label)) return [];
      const target = new URL(url);
      target.searchParams.set("sem", selected.val() as string);
      target.searchParams.set("grupa", id);
      return [{ url: target.href, label, context, academicYear: semester.academicYear,
        semester: semester.number, kind: "timetable", format: "html" }];
    });
  },
  parseHtml(html, source) {
    const $ = cheerio.load(html);
    const label = squash($("h3").first().text()).replace(/^Grupa:\s*/i, "");
    if (label !== source.label) throw new Error(`Expected group ${source.label}, received ${label}.`);
    const term = $("#sem option[selected]").text();
    if (detectAcademicYear(term) !== source.academicYear || detectSemester(term) !== source.semester) {
      throw new Error(`The faculty returned a different semester for ${label}.`);
    }
    const [, cycle, year, code] = /^([LM])(\d) (\S+)$/.exec(label)!;
    const spec = { name: programmes[code] ?? code, code, language: "RO",
      degree: cycle === "L" ? "bachelor" as const : "master" as const };
    const names = [...new Set($("table.orar td.sg").map((_, el) => squash($(el).text())).get().filter(Boolean))].sort();
    const groups = (names.length ? names : [""]).map((name) => ({ spec, year: +year, series: "", name }));
    const entries: NormalizedEntry[] = [];
    let day: number | null = null;
    let time: ReturnType<typeof parseTimeRange> = null;
    for (const row of $("table.orar tr").toArray()) {
      const cell = (cls: string) => squash($(row).children("td." + cls).text());
      const courseName = cell("disc");
      if (!courseName) continue;
      if (cell("wkd")) day = parseDayWord(cell("wkd"));
      if (cell("ore")) {
        const hour = $(row).children("td.ore").clone();
        hour.find("sup").each((_, m) => { $(m).replaceWith(":" + $(m).text()); });
        time = parseTimeRange(hour.text());
      }
      const rule = cell("weeks");
      if (!day || !time || !/^(?:[IP](?: |$))?(?:\d+(?:-\d+)?)?$/.test(rule)) {
        throw new Error(`Unrecognised day, hour or teaching weeks for ${courseName}.`);
      }
      const weeks = rule.split(" ").map((w) => w === "I" ? "odd" : w === "P" ? "even" : /^\d+$/.test(w) ? `${w}-${w}` : w).join("&") || "all";
      entries.push({ sheet: label, day, ...time, courseName, kind: kinds[cell("cslp")] ?? "other",
        weeks, room: cell("sala") || null, teacher: cell("cadru") || null,
        courseAbbr: null, rawText: $(row).children("td").map((_, td) => squash($(td).text())).get().filter(Boolean).join(" · "),
        isSlotOption: false, groups: groups.flatMap((g, i) => !cell("sg") || cell("sg") === g.name ? [i] : []) });
    }
    return { groups, entries, warnings: [] };
  },
};
