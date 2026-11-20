/**
 * Command-line entry to the scraping engine (the admin page calls the same code).
 *
 *   npm run scrape                     catalog + timetables + exams, all faculties
 *   npm run scrape -- --only=AC,MPT    limit to faculties by acronym
 *   npm run scrape -- --no-catalog --dry-run
 */
import { getDb } from "../src/db";
import { faculties } from "../src/db/schema";
import { runScrape } from "../src/scraper/engine";

async function main() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const only = args.find((a) => a.startsWith("--only="))?.slice(7).split(",").map((s) => s.trim().toLowerCase());

  const catalog = !has("--no-catalog");
  let facultyIds: number[] | undefined;
  if (only?.length) {
    // Acronyms come from the catalog, so make sure it exists before filtering by them.
    if (catalog) await runScrape({ catalog: true, timetables: false, exams: false, triggeredBy: "cli" }, true);
    facultyIds = getDb()
      .select()
      .from(faculties)
      .all()
      .filter((f) => only.includes((f.shortName ?? "").toLowerCase()))
      .map((f) => f.id);
    if (!facultyIds.length) throw new Error(`No faculty matches --only=${only.join(",")}`);
  }

  const result = await runScrape(
    {
      catalog: catalog && !only?.length,
      timetables: !has("--no-timetables"),
      exams: !has("--no-exams"),
      facultyIds,
      dryRun: has("--dry-run"),
      triggeredBy: "cli",
    },
    true,
  );
  console.log(`\nRun #${result.runId}: ${result.status}`, result.stats);
  process.exit(result.status === "failed" ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
