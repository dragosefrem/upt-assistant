import { count, eq } from "drizzle-orm";
import type { DB } from "./index";
import { buildings, semesters, faculties } from "./schema";

/**
 * Reference data the scraper cannot discover: the academic calendar (Senate decision
 * HS 26/19.03.2026) and where room codes are on campus. Admins can edit both later;
 * seeding only fills empty tables.
 */

function mondays(from: string, weeks: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  for (let i = 0; i < weeks; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

const SEMESTERS = [
  {
    academicYear: "2026-2027",
    number: 1,
    startDate: "2026-09-28",
    endDate: "2027-01-22",
    // 12 weeks, winter holiday 21.12–10.01, then 2 more weeks.
    teachingWeeks: [...mondays("2026-09-28", 12), ...mondays("2027-01-11", 2)],
    examStart: "2027-01-25",
    examEnd: "2027-02-21",
  },
  {
    academicYear: "2026-2027",
    number: 2,
    startDate: "2027-03-01",
    endDate: "2027-06-11",
    // 8 weeks, Easter holiday 26.04–03.05, then 6 more weeks.
    teachingWeeks: [...mondays("2027-03-01", 8), ...mondays("2027-05-03", 6)],
    examStart: "2027-06-14",
    examEnd: "2027-07-11",
  },
];

/**
 * Coordinates of faculty buildings come from upt.ro; the others (marked in `notes`)
 * were placed from the street addresses in the AC room legend and are approximate.
 */
const BUILDINGS = [
  { code: "MPT", name: "Facultatea MPT", address: "Str. Remus 14, Timișoara", lat: 45.745735, lng: 21.22275, roomPattern: "MPT", scope: "", priority: 10 },
  { code: "MEC", name: "Facultatea de Mecanică", address: "Bd. Mihai Viteazu 1, Timișoara", lat: 45.746042, lng: 21.225743, roomPattern: "\\bMEC\\b|Orol|^N\\s?\\d{3}", scope: "", priority: 10 },
  { code: "CHIM", name: "Facultatea de Chimie (inclusiv Chimie Parc)", address: "Bd. Vasile Pârvan 6, Timișoara", lat: 45.747792, lng: 21.233185, roomPattern: "\\d{3}\\s?CP\\b|chimi", scope: "", priority: 10 },
  { code: "ASPC", name: "ASPC – Atelier Școlar pentru Proiectare și Cercetare", address: "Str. Ioan Curea 1, Timișoara", lat: 45.7463, lng: 21.2292, roomPattern: "ASPC|^S4$|^P\\s?1[47]$|^P1$", scope: "", priority: 20, notes: "Approximate position" },
  { code: "SPM", name: "Clădirea SPM", address: "Bd. Mihai Viteazu (vizavi de căminul 2MV), Timișoara", lat: 45.7452, lng: 21.2262, roomPattern: "SPM|CIDUCOS", scope: "", priority: 20, notes: "Approximate position" },
  { code: "HIDRO", name: "Departamentul de Hidrotehnică", address: "Str. George Enescu 1/A, Timișoara", lat: 45.7493, lng: 21.2247, roomPattern: "^PN$|hidro", scope: "", priority: 20, notes: "Approximate position" },
  { code: "CT", name: "Facultatea de Construcții", address: "Str. Traian Lalescu 2, Timișoara", lat: 45.745594, lng: 21.229903, roomPattern: "Nicolae Maior|constru|cadastru", scope: "", priority: 30 },
  { code: "ELECTRO", name: "Clădirea Electro (AC, ETcTI, IEE)", address: "Bd. Vasile Pârvan 2, Timișoara", lat: 45.747476, lng: 21.226228, roomPattern: "^[ABCD]\\s?\\d{1,3}[a-z]?$|^D1$", scope: "AC,ETcTI,IEE", priority: 50 },
  { code: "MPT-ROOMS", name: "Facultatea MPT", address: "Str. Remus 14, Timișoara", lat: 45.745735, lng: 21.22275, roomPattern: "^[AM]\\s?\\d{1,3}$", scope: "MPT", priority: 50 },
  { code: "ONLINE", name: "Online", address: null, lat: 0, lng: 0, roomPattern: "on\\s?line", scope: "", priority: 1 },
];

export function seed(db: DB) {
  const [{ n: semesterCount }] = db.select({ n: count() }).from(semesters).all();
  if (semesterCount === 0) {
    for (const s of SEMESTERS) {
      db.insert(semesters)
        .values({ ...s, teachingWeeks: JSON.stringify(s.teachingWeeks), isCurrent: false })
        .run();
    }
  }
  const [{ n: buildingCount }] = db.select({ n: count() }).from(buildings).all();
  if (buildingCount === 0) {
    for (const b of BUILDINGS) db.insert(buildings).values(b).run();
  }
  // Names read from upt.ro before they were stored in one Unicode form.
  for (const f of db.select({ id: faculties.id, name: faculties.name }).from(faculties).all()) {
    const name = f.name.normalize("NFC");
    if (name !== f.name) db.update(faculties).set({ name }).where(eq(faculties.id, f.id)).run();
  }
  // Exactly one semester is "current": the admin's explicit choice, else by date.
  const current = db.select().from(semesters).where(eq(semesters.isCurrent, true)).all();
  if (!current.length) {
    const all = db.select().from(semesters).all();
    const today = new Date().toISOString().slice(0, 10);
    const pick =
      all.find((s) => s.startDate <= today && today <= (s.examEnd ?? s.endDate)) ??
      all.filter((s) => s.startDate > today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0] ??
      all.sort((a, b) => b.startDate.localeCompare(a.startDate))[0];
    if (pick) db.update(semesters).set({ isCurrent: true }).where(eq(semesters.id, pick.id)).run();
  }
}
