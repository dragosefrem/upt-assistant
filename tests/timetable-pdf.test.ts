import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { printedSlugs } from "@/scraper/adapters/printedFaculties";
import { readPdf } from "@/scraper/pdf";
import type { DiscoveredSource, NormalizedTimetable } from "@/scraper/types";

/**
 * Timetable PDFs as the faculties published them in November 2026, read end to end: the
 * Python table reader (scripts/read-timetable-pdf.py) and the parser behind it. They need the
 * interpreter from scripts/requirements-timetables.txt, as importing a PDF does.
 */
const local = path.join(process.cwd(), ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
const python = process.env.TIMETABLE_PYTHON ?? (fs.existsSync(local) ? local : "python3");
let reader = true;
try {
  execFileSync(python, ["-c", "import pdfplumber"], { stdio: "ignore" });
} catch {
  reader = false;
}

const hm = (h: number, m = 0) => h * 60 + m;
const semester = { academicYear: "2026-2027", number: 1 };

async function read(file: string, slug: string, source: Partial<DiscoveredSource>) {
  const body = fs.readFileSync(path.join(__dirname, "fixtures", file));
  const full = { url: "https://example.org/" + file, label: file, context: "", kind: "timetable", format: "pdf", academicYear: "2026-2027", semester: 1, ...source } as DiscoveredSource;
  return readPdf(body, slug, full, semester);
}

/** The classes of one group on one day, earliest first. */
function day(tables: NormalizedTimetable[], group: string, weekday: number) {
  return tables.flatMap((t) => t.entries.filter((e) => e.day === weekday && e.groups.some((g) => t.groups[g].name === group)))
    .sort((a, b) => a.startMin - b.startMin);
}

describe.skipIf(!reader)("timetable PDFs, read from the published documents", () => {
  it("keeps a coloured three-hour lab in one piece (IEE, Inginerie electrică, year 1)", async () => {
    const { tables } = await read("iee-ing-electrica-an1-2026-27-sem1.pdf", printedSlugs.IEE, {
      label: "orar 1 Ing Electrica 26-27 sem1_1.pdf", context: "Licenta - ET - Sem 1 - An 1",
    });
    const all = tables.flatMap((t) => t.entries);
    // Thursday, group 1/1: "GAC (L) s:1-9 SPM Et. II sala 218" fills 17–20. Its background is
    // painted row by row, which used to cut it into a one-hour lab and a class named after the room.
    const thursday = day(tables, "1/1", 4);
    expect(thursday.find((e) => e.courseName === "GAC")).toMatchObject({ kind: "lab", startMin: hm(17), endMin: hm(20) });
    expect(all.filter((e) => /SPM Et\. II/.test(e.courseName))).toEqual([]);
    // Group 2/1, Wednesday: "EIM (L) săpt. imp." is two hours on odd weeks, not an hour every week
    // followed by a class called "săpt. imp.".
    expect(day(tables, "2/1", 3).find((e) => e.courseName === "EIM" && e.kind === "lab")).toMatchObject({ startMin: hm(14), endMin: hm(16), weeks: "odd" });
    expect(all.filter((e) => /^s[aă]pt/i.test(e.courseName))).toEqual([]);
    // No class of this page lasts a single hour except the two preparation courses printed that way.
    expect(all.filter((e) => e.endMin - e.startMin === 60).map((e) => e.courseName).sort()).toEqual(
      expect.arrayContaining(["Curs de pregătire la Matematică"]),
    );
  });
});
