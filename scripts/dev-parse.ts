/* Developer aid: `npx tsx scripts/dev-parse.ts <file.xlsx|file.html> [sheet-filter] [--full]` */
import fs from "node:fs";
import { loadHtmlTables, loadWorkbook } from "../src/scraper/grid";
import { parseTimetable } from "../src/scraper/timetable";
import { formatMinutes } from "../src/scraper/text";

async function main() {
  const [file, filter] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const full = process.argv.includes("--full");
  const data = fs.readFileSync(file);
  const isHtml = data.subarray(0, 200).toString().trimStart().startsWith("<");
  const grids = isHtml ? loadHtmlTables(data.toString("utf8")) : await loadWorkbook(data);
  const DAYS = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  for (const grid of grids) {
    if (filter && !grid.name.toLowerCase().includes(filter.toLowerCase())) continue;
    const t = parseTimetable(grid);
    console.log(`\n## ${grid.name} — "${t.title}" year=${t.year} groups=${t.groups.length} entries=${t.entries.length}`);
    console.log("   groups:", t.groups.map((g) => `${g.track ?? "-"}/${g.name}`).join(", ").slice(0, 600));
    for (const w of t.warnings) console.log("   ! " + w);
    const list = full ? t.entries : t.entries.slice(0, 12);
    for (const e of list) {
      console.log(
        `   ${DAYS[e.day]} ${formatMinutes(e.startMin)}-${formatMinutes(e.endMin)} [${e.kind}${e.isSlotOption ? "*" : ""}] ` +
          `${e.courseName}${e.courseAbbr ? ` (${e.courseAbbr})` : ""} | room=${e.room} | teacher=${e.teacher} | weeks=${e.weeks} | g=${e.groups.length === t.groups.length ? "ALL" : e.groups.map((i) => t.groups[i].name).join(",")}`,
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
