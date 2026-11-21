import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { pageTerm, printedColumns, printedSlugs } from "./adapters/printedFaculties";
import { civilCell, electricalActivities, electricalCell, readPrintedTable, type Box } from "./printed";
import type { DiscoveredSource, NormalizedTimetable, SemesterRef } from "./types";

interface PdfPage { text: string; tables: Box[][] }

function extractPages(body: Buffer): Promise<PdfPage[]> {
  const local = path.join(process.cwd(), ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python");
  const python = process.env.TIMETABLE_PYTHON ?? (existsSync(local) ? local : "python3");
  return new Promise((resolve, reject) => {
    const proc = execFile(python, [path.join(process.cwd(), "scripts/read-timetable-pdf.py")],
      { maxBuffer: 32 * 1024 * 1024, timeout: 90_000, encoding: "utf8" }, (err, stdout, stderr) => {
        if (err) {
          reject(new Error(stderr.includes("No module named 'pdfplumber'")
            ? "Install the timetable PDF reader from scripts/requirements-timetables.txt in .venv."
            : `Could not read the timetable PDF: ${stderr.trim() || err.message}`));
          return;
        }
        try { resolve(JSON.parse(stdout)); } catch (error) { reject(error); }
      });
    proc.stdin?.on("error", reject);
    proc.stdin?.end(body);
  });
}

export async function readPdf(body: Buffer, slug: string, source: DiscoveredSource, semester: SemesterRef) {
  if (!body.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("The timetable link did not return a PDF.");
  const pages = await extractPages(body);
  const tables: NormalizedTimetable[] = [];
  const warnings: string[] = [];
  let unreadable = false;
  let excludedPages = 0;
  const range = /s[aă]pt[_ .]*(\d+)[-–](\d+)/i.exec(source.label);
  const documentWeeks = range ? range[1] + "-" + range[2] : "all";
  for (const [i, page] of pages.entries()) {
    const name = `Page ${i + 1}`;
    const term = pageTerm(page.text);
    if ((term.academicYear && term.academicYear !== semester.academicYear) ||
        (term.semester && term.semester !== semester.number)) {
      excludedPages++;
      warnings.push(`${name} is labelled ${term.academicYear ?? ""} semester ${term.semester ?? "?"}. Check the faculty publication.`);
      continue;
    }
    const pageTables = page.tables.map((cells) => readPrintedTable(cells, name,
      (header, right) => printedColumns(slug, source, page.text, header, right), documentWeeks,
      slug === printedSlugs.IEE ? electricalCell : slug === printedSlugs.CT ? civilCell : undefined,
      { splitSharedHours: slug === printedSlugs.MEC, splitActivities: slug === printedSlugs.IEE ? electricalActivities : undefined },
    )).filter((t) => t.entries.length);
    if (!pageTables.length && /\b\d{1,2}\s*[-–_]\s*\d{1,2}\b/.test(page.text) && /\b(?:ora|ore|hour)\b/i.test(page.text)) {
      unreadable = true;
      warnings.push(`${name} contains an unrecognised timetable.`);
    }
    tables.push(...pageTables);
  }
  return { tables, warnings, unreadable, excludedPages };
}
