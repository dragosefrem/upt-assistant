/* Developer aid: `npx tsx scripts/dev-exams.ts <exam-workbook.xlsx>` */
import fs from "node:fs";
import { loadWorkbook } from "../src/scraper/grid";
import { parseRoomGridExams } from "../src/scraper/exams";
import { formatMinutes } from "../src/scraper/text";

async function main() {
  const grids = await loadWorkbook(fs.readFileSync(process.argv[2]));
  for (const grid of grids) {
    const exams = parseRoomGridExams(grid);
    console.log(`## ${grid.name}: ${exams.length} exams`);
    for (const e of exams.slice(0, 14)) {
      console.log(
        `   ${e.date} ${formatMinutes(e.startMin)}-${formatMinutes(e.endMin)} ${e.room} | ${e.audience} y${e.year} | ${e.courseAbbr} | ${e.detail} | ${e.teacher}`,
      );
    }
  }
}
main();
