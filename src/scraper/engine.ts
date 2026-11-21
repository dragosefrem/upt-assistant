import { createHash } from "node:crypto";
import { and, eq, inArray, notInArray } from "drizzle-orm";
import { getDb, type DB } from "@/db";
import { entries, exams, faculties, scrapeRuns, semesters, sources, timetablePdfs } from "@/db/schema";
import { adapterFor } from "./adapters";
import { genericNormalize } from "./adapters/generic";
import { distanceSource, distanceTimetable, loadDistanceCalendar } from "./distance";
import { Importer, applyCatalog } from "./apply";
import { scrapeCatalog } from "./catalog";
import {
  classifyLink,
  detectAcademicYear,
  detectSemester,
  downloadUrl,
  extractLinks,
  matchesSemester,
} from "./discover";
import { loadHtmlTables, loadWorkbook, type Grid } from "./grid";
import { fetchText, fetchUrl } from "./http";
import { parseTimetable } from "./timetable";
import { readPdf } from "./pdf";
import type { DiscoveredSource, NormalizedTimetable, SemesterRef } from "./types";

/**
 * The scraping engine: refreshes the university catalog from upt.ro, discovers every
 * faculty's timetable and exam documents, parses the ones in a machine-readable
 * format and replaces what the database holds for them.
 */

export interface ScrapeOptions {
  catalog: boolean;
  timetables: boolean;
  exams: boolean;
  /** Limit to these faculties (ids); empty or omitted = all. */
  facultyIds?: number[];
  /** Parse and report, but leave timetable and exam data untouched. */
  dryRun?: boolean;
  triggeredBy?: string;
}

export interface ScrapeStats {
  faculties: number;
  specializations: number;
  sourcesFound: number;
  sourcesImported: number;
  sourcesUnsupported: number;
  sourcesFailed: number;
  entries: number;
  exams: number;
  warnings: number;
}

class RunLog {
  private lines: string[] = [];
  constructor(
    private readonly db: DB,
    readonly runId: number,
    private readonly echo: boolean,
  ) {}
  add(line: string) {
    const stamped = `[${new Date().toISOString().slice(11, 19)}] ${line}`;
    this.lines.push(stamped);
    if (this.echo) console.log(stamped);
    // Persist as we go so the admin page can show progress while a run is active.
    this.db.update(scrapeRuns).set({ log: this.lines.join("\n") }).where(eq(scrapeRuns.id, this.runId)).run();
  }
}

/** Fetches a spreadsheet source and returns its sheets as grids. */
export async function loadGrids(source: Pick<DiscoveredSource, "url" | "format">): Promise<{ grids: Grid[]; hash: string }> {
  const hash = createHash("sha1");
  if (source.format === "gsheet") {
    // Published Google Sheets render client-side; the per-tab "sheet" endpoint still
    // returns a plain HTML table (with merged cells, which CSV export would lose).
    const base = source.url.split("/pub")[0];
    let gids = [new URL(source.url).searchParams.get("gid")].filter((g): g is string => !!g);
    if (!gids.length) {
      const { text } = await fetchText(source.url);
      gids = [...new Set([...text.matchAll(/gid=(\d+)/g)].map((m) => m[1]))];
    }
    const grids: Grid[] = [];
    for (const gid of gids) {
      const { text } = await fetchText(`${base}/pubhtml/sheet?headers=false&gid=${gid}`);
      hash.update(text);
      grids.push(...loadHtmlTables(text, `gid ${gid}`));
    }
    return { grids, hash: hash.digest("hex") };
  }
  const res = await fetchUrl(downloadUrl(source));
  hash.update(res.body);
  // Workbooks are zip archives ("PK"); anything else is a login or error page.
  if (res.body.subarray(0, 2).toString("latin1") !== "PK") {
    throw new Error("The link did not return an Excel workbook (it may require signing in).");
  }
  return { grids: await loadWorkbook(res.body), hash: hash.digest("hex") };
}

async function discover(
  faculty: typeof faculties.$inferSelect,
  semester: SemesterRef,
  page: "timetable" | "exams",
  log: RunLog,
): Promise<DiscoveredSource[]> {
  const adapter = adapterFor(faculty.slug);
  const pages =
    page === "timetable"
      ? (adapter.timetablePages?.(semester, faculty.scheduleUrl) ?? (faculty.scheduleUrl ? [faculty.scheduleUrl] : []))
      : (adapter.examPages?.(semester) ?? []);
  const found = new Map<string, DiscoveredSource>();
  const scan = async (url: string, inherited = "") => {
    const { text, finalUrl } = await fetchText(url);
    const links = extractLinks(text, finalUrl);
    if (page === "timetable" && adapter.timetableSources) {
      for (const s of await adapter.timetableSources(text, finalUrl, semester)) {
        if (!matchesSemester(s, semester)) continue;
        const previous = found.get(s.url);
        if (!previous) found.set(s.url, s);
        else if (!previous.label.split(" / ").includes(s.label)) previous.label += " / " + s.label;
      }
      log.add(`${faculty.shortName ?? faculty.name}: scanned ${url}`);
      return { links, finalUrl };
    }
    for (const link of links) {
      const guess = classifyLink(inherited ? { ...link, context: `${inherited} ${link.context}` } : link, page);
      if (!guess) continue;
      const source = adapter.classify ? adapter.classify(link, guess, semester, page) : guess;
      if (!source || !matchesSemester(source, semester)) continue;
      if (!found.has(source.url)) found.set(source.url, source);
    }
    log.add(`${faculty.shortName ?? faculty.name}: scanned ${url}`);
    return { links, finalUrl };
  };
  for (const url of pages) {
    const { links, finalUrl } = await scan(url);
    if (found.size || page !== "timetable") continue;
    // Some faculties list one post per semester and attach the documents there.
    const host = new URL(finalUrl).host;
    const posts = links.filter(
      (l) =>
        new URL(l.url).host === host &&
        /\borar/i.test(l.label) &&
        detectAcademicYear(l.label) === semester.academicYear &&
        (detectSemester(l.label) ?? semester.number) === semester.number,
    );
    for (const post of [...new Map(posts.map((p) => [p.url, p])).values()].slice(0, 3)) {
      await scan(post.url, post.label);
    }
  }
  return [...found.values()];
}

export async function runScrape(options: ScrapeOptions, echo = false): Promise<{ runId: number; status: string; stats: ScrapeStats }> {
  const db = getDb();
  const scope = [options.catalog && "catalog", options.timetables && "timetables", options.exams && "exams"]
    .filter(Boolean)
    .join("+");
  const run = db
    .insert(scrapeRuns)
    .values({
      startedAt: new Date().toISOString(),
      scope: scope || "nothing",
      dryRun: !!options.dryRun,
      triggeredBy: options.triggeredBy ?? null,
    })
    .returning({ id: scrapeRuns.id })
    .get();
  const log = new RunLog(db, run.id, echo);
  const stats: ScrapeStats = {
    faculties: 0,
    specializations: 0,
    sourcesFound: 0,
    sourcesImported: 0,
    sourcesUnsupported: 0,
    sourcesFailed: 0,
    entries: 0,
    exams: 0,
    warnings: 0,
  };
  let failed = false;
  const warn = (line: string) => {
    stats.warnings++;
    log.add(`⚠ ${line}`);
  };

  try {
    if (options.catalog) {
      log.add("Reading faculties and study programmes from upt.ro…");
      const catalog = await scrapeCatalog((line) => log.add(line));
      catalog.warnings.forEach(warn);
      if (catalog.faculties.length === 0) throw new Error("upt.ro returned no faculties; keeping the existing catalog.");
      const applied = applyCatalog(db, catalog);
      stats.faculties = applied.faculties;
      stats.specializations = applied.specializations;
      log.add(`Catalog updated: ${applied.faculties} faculties, ${applied.specializations} programmes.`);
    }

    const semester = db.select().from(semesters).where(eq(semesters.isCurrent, true)).get();
    if ((options.timetables || options.exams) && !semester) throw new Error("No current semester is configured.");

    if (semester && (options.timetables || options.exams)) {
      const all = db.select().from(faculties).all();
      const selected = options.facultyIds?.length ? all.filter((f) => options.facultyIds!.includes(f.id)) : all;
      if (!selected.length) warn("No faculties in the database yet — run the catalog scrape first.");
      log.add(`Target: semester ${semester.number} of ${semester.academicYear}${options.dryRun ? " (dry run)" : ""}.`);

      let distanceCalendar: ReturnType<typeof loadDistanceCalendar> | undefined;
      for (const faculty of selected) {
        const adapter = adapterFor(faculty.slug);
        const name = faculty.shortName ?? faculty.name;

        for (const page of ["timetable", "exams"] as const) {
          if (page === "timetable" ? !options.timetables : !options.exams) continue;
          let found: DiscoveredSource[] = [];
          let pageRead = true;
          try {
            found = await discover(faculty, semester, page, log);
          } catch (err) {
            failed = true;
            pageRead = false;
            warn(`${name}: could not read the ${page} page — ${(err as Error).message}`);
          }
          const kind = page;
          found = found.filter((source) => source.kind === kind);
          // A separate Campus Virtual feed cannot confirm that a faculty withdrew its
          // regular timetables. Retire those only after finding faculty publications.
          let complete = pageRead && found.length > 0;
          if (pageRead && !found.length && page === "timetable") {
            failed = true;
            warn(`${name}: no published timetable found on the faculty page for the selected semester.`);
          }
          const distance = distanceSource(name, semester, page);
          if (distance) found.push(distance);
          stats.sourcesFound += found.length;
          if (page === "timetable" || found.length) log.add(`${name}: ${found.length} ${kind} document(s) for this semester.`);


          for (const source of found) {
            const meta = {
              label: source.label,
              context: source.context,
              kind: source.kind,
              format: source.format,
              academicYear: source.academicYear ?? semester.academicYear,
              semester: source.semester ?? semester.number,
            };
            const row = options.dryRun
              ? null
              : db
                  .insert(sources)
                  .values({ facultyId: faculty.id, url: source.url, ...meta })
                  .onConflictDoUpdate({ target: [sources.facultyId, sources.url], set: meta })
                  .returning({ id: sources.id, itemCount: sources.itemCount })
                  .get();
            const finish = (status: string, message: string | null, itemCount = 0, contentHash?: string) => {
              if (!row) return;
              db.update(sources)
                .set({ status, message, itemCount, contentHash, lastFetchedAt: new Date().toISOString() })
                .where(eq(sources.id, row.id))
                .run();
            };

            const parseable = source.reader === "distance" || source.format === "xlsx" || source.format === "gsheet" ||
              (kind === "timetable" && (source.format === "pdf" || (source.format === "html" && adapter.parseHtml)));
            if (!parseable || (kind === "exams" && !adapter.parseExams && source.reader !== "distance")) {
              stats.sourcesUnsupported++;
              complete = false;
              failed = true;
              finish(
                "unsupported",
                source.format === "pdf"
                  ? "PDF document: linked for students, not machine-readable."
                  : !parseable
                    ? "External document: linked for students, not machine-readable."
                    : "No exam parser for this faculty's format yet.",
              );
              continue;
            }

            try {
              const importer = new Importer(db, faculty.id, semester.id);
              if (source.reader === "distance") {
                distanceCalendar ??= loadDistanceCalendar(semester.startDate, semester.examEnd ?? semester.endDate);
                const result = distanceTimetable(await distanceCalendar, name, semester);
                const issues = kind === "exams" ? result.examWarnings : [];
                const count = kind === "exams"
                  ? (row ? importer.importExams(row.id, source.label, result.exams) : result.exams.length)
                  : (row ? importer.importTimetable(row.id, [result.table]).entries : result.table.entries.length);
                if (kind === "exams") stats.exams += count;
                else stats.entries += count;
                for (const issue of issues) warn(name + ": " + issue);
                if (issues.length) failed = true;
                const message = `${count} dated ${kind === "exams" ? "assessments" : "activities"}. ${issues.join(" ")}`.trim();
                finish(issues.length ? "partial" : "imported", message, count, result.hash);
                stats.sourcesImported++;
                log.add(`${name}: "${source.label}" → ${message}`);
                continue;
              }
              if (kind === "exams") {
                const { grids, hash } = await loadGrids(source);
                const list = adapter.parseExams!(grids, source);
                const n = row ? importer.importExams(row.id, source.label, list) : list.length;
                stats.exams += n;
                stats.sourcesImported++;
                finish("imported", `${n} exam booking(s).`, n, hash);
                log.add(`${name}: "${source.label}" → ${n} exam(s).`);
                continue;
              }

              const tables: NormalizedTimetable[] = [];
              const issues: string[] = [];
              let skipped = 0;
              let unreadable = false;
              let excludedPages = 0;
              let hash: string;
              if (source.format === "pdf" || source.format === "html") {
                const { body } = await fetchUrl(downloadUrl(source));
                hash = createHash("sha1").update(body).digest("hex");
                if (source.format === "pdf") {
                  if (row && body.subarray(0, 5).toString() === "%PDF-") {
                    db.insert(timetablePdfs).values({ sourceId: row.id, content: body })
                      .onConflictDoUpdate({ target: timetablePdfs.sourceId, set: { content: body } }).run();
                  }
                  const pdf = await readPdf(body, faculty.slug, source, semester);
                  tables.push(...pdf.tables);
                  issues.push(...pdf.warnings);
                  unreadable = pdf.unreadable;
                  excludedPages = pdf.excludedPages;
                } else {
                  const table = adapter.parseHtml!(body.toString("utf8"), source);
                  if (table.entries.length) tables.push(table);
                }
              } else {
                const workbook = await loadGrids(source);
                hash = workbook.hash;
                for (const grid of workbook.grids) {
                  const table = adapter.parseGrid ? adapter.parseGrid(grid, source)
                    : adapter.normalize ? adapter.normalize(parseTimetable(grid), source, grid)
                      : genericNormalize(parseTimetable(grid), source);
                  if (!table?.entries.length) {
                    skipped++;
                    if (!/legend|desf[aă][sș]urare ore/i.test(grid.name)) {
                      unreadable = true;
                      issues.push(`Sheet "${grid.name}" has no recognised activities.`);
                    }
                    continue;
                  }
                  tables.push(table);
                }
              }
              tables.forEach((t) => t.warnings.forEach(warn));
              issues.forEach((issue) => warn(`${name}: "${source.label}" — ${issue}`));
              if (issues.length) failed = true;
              if (unreadable) complete = false;
              const total = tables.reduce((n, t) => n + t.entries.length, 0);
              if (!total) {
                // An explicitly dated replacement withdraws its old classes. Keep
                // the original document available and report the faculty's dates.
                if (excludedPages && !unreadable) {
                  if (row) importer.importTimetable(row.id, []);
                  stats.sourcesImported++;
                  finish("partial", issues.join(" "), 0, hash);
                  continue;
                }
                stats.sourcesFailed++;
                complete = false;
                failed = true;
                finish("failed", "No timetable grid recognised in this document.", 0, hash);
                warn(`${name}: "${source.label}" — no timetable grid recognised.`);
                continue;
              }
              const result = row ? importer.importTimetable(row.id, tables) : { entries: total, courses: 0, groups: 0 };
              stats.entries += result.entries;
              stats.sourcesImported++;
              finish(
                issues.length ? "partial" : "imported",
                `${tables.length} table(s), ${result.entries} activities${skipped ? `, ${skipped} sheet(s) skipped` : ""}. ${issues.join(" ")}`.trim(),
                result.entries,
                hash,
              );
              log.add(`${name}: "${source.label}" → ${tables.length} sheet(s), ${result.entries} activities.`);
            } catch (err) {
              failed = true;
              complete = false;
              stats.sourcesFailed++;
              const existing = row?.itemCount ?? 0;
              const message = (err as Error).message + (existing ? ` Keeping ${existing} previously imported items.` : "");
              finish("failed", message, existing);
              warn(`${name}: "${source.label}" failed — ${(err as Error).message}`);
            }
          }
          // Only retire replaced publications after their replacements have imported.
          if (complete && !options.dryRun) {
            const gone = db.select({ id: sources.id }).from(sources).where(and(
              eq(sources.facultyId, faculty.id), eq(sources.kind, kind),
              eq(sources.academicYear, semester.academicYear), eq(sources.semester, semester.number),
              notInArray(sources.url, found.map((s) => s.url)),
            )).all().map((s) => s.id);
            if (gone.length) db.transaction((tx) => {
              tx.delete(entries).where(inArray(entries.sourceId, gone)).run();
              tx.delete(exams).where(inArray(exams.sourceId, gone)).run();
              tx.delete(sources).where(inArray(sources.id, gone)).run();
            });
          }
        }
        if (!options.dryRun) new Importer(db, faculty.id, semester.id).prune();
      }
    }
  } catch (err) {
    failed = true;
    log.add(`✖ ${(err as Error).message}`);
  }

  const imported = stats.sourcesImported > 0 || stats.faculties > 0;
  const status = failed ? (imported ? "partial" : "failed") : "success";
  log.add(
    `Finished: ${stats.sourcesImported} imported, ${stats.sourcesUnsupported} not machine-readable, ${stats.sourcesFailed} failed; ` +
      `${stats.entries} activities, ${stats.exams} exams.`,
  );
  db.update(scrapeRuns)
    .set({ finishedAt: new Date().toISOString(), status, stats: JSON.stringify(stats) })
    .where(eq(scrapeRuns.id, run.id))
    .run();
  return { runId: run.id, status, stats };
}
