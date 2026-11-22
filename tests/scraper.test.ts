import fs from "node:fs";
import { describeWeeks, weekMatches } from "@/lib/time";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { acAdapter } from "@/scraper/adapters/ac";
import { fihAdapter } from "@/scraper/adapters/fih";
import { etcAdapter, fscAdapter } from "@/scraper/adapters/others";
import { pageTerm } from "@/scraper/adapters/printedFaculties";
import { roboticsActivities, roboticsAudience } from "@/scraper/adapters/ria";
import { civilCell, civilDetail, electricalActivities, electricalCell, headerColumns, readPrintedTable, type Box } from "@/scraper/printed";
import { extractSpecializations, parseProgrammeLabel } from "@/scraper/catalog";
import { hourLoads, parseCellText } from "@/scraper/cellText";
import { distanceTimetable } from "@/scraper/distance";
import { classifyLink, detectAcademicYear, detectSemester, downloadUrl, extractLinks, matchesSemester } from "@/scraper/discover";
import { parseExamCell, parseRoomGridExams } from "@/scraper/exams";
import { Grid, loadHtmlTables, loadWorkbook } from "@/scraper/grid";
import { acronym, activityTime, parseStudyYear, parseTimeRange } from "@/scraper/text";
import { parseSlotNote, parseTimetable } from "@/scraper/timetable";
import type { DiscoveredSource } from "@/scraper/types";

/** Real documents downloaded from UPT faculty sites in November 2026. */
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name));

const hm = (h: number, m = 0) => h * 60 + m;

describe("published timetable corrections", () => {
  it("keeps week lists, range intersections and a lecture's explicit end time", () => {
    expect(parseCellText("TI (p) B027B, s. impară")).toMatchObject({ room: "B027B", weeks: "odd" });
    expect(parseCellText("MT (s) s. 1-7 s. para").weeks).toBe("1-7&even");
    expect(parseCellText("Sapt. 8-14: para Notiuni de stiinta si tehnica (s)").weeks).toBe("8-14&even");
    expect(parseCellText("Etică (s) săpt. 4 , 8, 12, 14 (17.00-18.00)").weeks).toBe("4,8,12,14");
    expect(activityTime("TI (c) B027B I. Filip (12-13.30)", { startMin: 720, endMin: 840 })).toEqual({ startMin: 720, endMin: 810 });
  });

  it("ignores a black-on-black Excel divider and preserves a narrow legible column", async () => {
    const workbook = new ExcelJS.Workbook(), sheet = workbook.addWorksheet("Master An I");
    for (const [column, width] of [[1, 20], [2, 0.43], [3, 0.43]]) sheet.getColumn(column).width = width;
    for (const address of ["A1", "B1", "C1"]) sheet.getCell(address).value = "AES";
    sheet.getCell("B1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF000000" } };
    sheet.getCell("B1").font = { color: { argb: "FF000000" } };
    const [grid] = await loadWorkbook(Buffer.from(await workbook.xlsx.writeBuffer()));
    expect(grid.cells.map((c) => [c.col, c.text])).toEqual([[1, "AES"], [2, "AES"]]);
  });

  it("keeps the first-week AC change and the room for each supplementary lab", async () => {
    const grids = await loadWorkbook(fixture("ac-cti-2026-27-sem1.xlsx"));
    const year = parseTimetable(grids.find((g) => g.name === "An 1")!);
    const moved = year.entries.filter((e) => e.rawText.includes("se tine luni"));
    expect(moved).toEqual(expect.arrayContaining([
      expect.objectContaining({ day: 1, startMin: 960, endMin: 1200, room: "M304 - MEC", weeks: "1" }),
      expect.objectContaining({ room: "A117", weeks: "!1" }),
    ]));
    expect(year.entries.filter((e) => e.rawText.includes("grupe suplimentare")).map((e) => e.room)).toEqual(["B528b", "B418a", "B528a"]);
    expect(year.entries.find((e) => e.rawText.includes("A3 Chimie"))).toMatchObject({ room: "A3 Chimie", publishedOptional: true });
  });

  it("splits the two activities and the language groups printed in an FSC cell", async () => {
    const grids = await loadWorkbook(fixture("fsc-crp-2026-27-sem1.xlsx"));
    const source: DiscoveredSource = { url: "https://sc.upt.ro/ORAR_CRP_sem1.xlsx", label: "Comunicare și relații publice",
      context: "", kind: "timetable", format: "xlsx", academicYear: "2026-2027", semester: 1 };
    const table = fscAdapter.parseGrid!(grids[1], source)!;
    expect(table.entries.filter((e) => e.kind === "seminar" && /lexic specializat/i.test(e.courseName))
      .map((e) => [e.weeks, e.groups.map((i) => table.groups[i].name)])).toEqual([["odd", ["1 franceză"]], ["even", ["2 germană"]]]);
    const master = new Grid("TINT II");
    master.add({ row: 1, col: 1, rowSpan: 1, colSpan: 5, text: "Programul de studii univ. de masterat: Traducere" });
    for (let i = 0; i < 4; i++) master.add({ row: i + 2, col: 2, rowSpan: 1, colSpan: 1, text: (8 + 2 * i) + "-" + (10 + 2 * i) });
    master.add({ row: 2, col: 3, rowSpan: 1, colSpan: 3, text: "Subtitrare (c) A208" });
    expect(parseTimetable(master).groups.map((g) => g.name)).toEqual([""]);
  });

  it("reads the intermediate MEC hour where one full-cohort lecture gives way to another", () => {
    const cells: Box[] = [[1, 0, 2, 1, "Grupa 1"], [0, 1, 1, 3, "08_10"], [0, 3, 1, 5, "10_12"],
      [0, 5, 1, 9, "12_14"], [1, 1, 2, 4, "Chimie - curs"], [1, 4, 2, 8, "Știința materialelor (c)"], [1, 8, 2, 9, "Fizică (c)"]];
    const group = { spec: { name: "Bioinginerie", degree: "bachelor" as const }, year: 1, name: "1", series: "" };
    const table = readPrintedTable(cells, "IA", () => [{ left: 1, right: 2, group }], "all", undefined, { splitSharedHours: true });
    expect(table.entries.map((e) => [e.startMin, e.endMin])).toEqual([[480, 660], [660, 780], [780, 840]]);
    expect(electricalActivities("Sala405, RM (L) s. pare\nBH (L) s. impare").map(electricalCell))
      .toMatchObject([{ name: "RM", weeks: "even", room: "405" }, { name: "BH", weeks: "odd" }]);
  });

  it("imports dated ID meetings, subgroup rooms and exam sittings from the public agenda", () => {
    const meeting = { shortname: "S1-ID-INFO1-IPC", fullname: "Introducere în programarea calculatoarelor",
      eventname: "Curs_IPC_Info ID_Anul 1", date: "2026-11-14 16:30:00",
      description: "FIZIC Grupa 1+2 (sala B019- Electro) Grupa 3+4 ( C402-C403- sediul DeL)" };
    const { table, exams } = distanceTimetable([meeting, { ...meeting, date: "2026-12-12 10:00:00", description: "ONLINE" },
      { ...meeting, date: "2026-11-14 00:00:00", description: "Cursul se va recupera Online la o alta data." },
      { ...meeting, date: "2027-01-16 08:00:00", description: "Sala A105", eventname: "ED_IPC_INFO1_P1" },
      { ...meeting, shortname: "S1-ID-TST1-IPC" }], "RIA", { academicYear: "2026-2027", number: 1 });
    expect(table.groups.map((g) => g.name)).toEqual(["1", "2", "3", "4"]);
    expect(table.entries).toMatchObject([
      { day: 6, weeks: "2026-11-14", startMin: 990, endMin: 990, room: "B019- Electro", groups: [0, 1] },
      { room: "C402-C403", groups: [2, 3] }, { weeks: "2026-12-12", room: "online", groups: [0, 1, 2, 3] },
    ]);
    expect(exams).toMatchObject([{ date: "2027-01-16", year: 1, specs: [{ name: "Informatică", language: "RO, ID" }] }]);
  });

  it("reads the separate room and teacher row below a Civil Engineering class", () => {
    const cells: Box[] = [[0, 1, 1, 3, "14-16"], [0, 3, 1, 5, "16-18"], [0, 5, 1, 7, "18-20"],
      [1, 1, 2, 2, "C-ții din lemn s8-13"], [1, 2, 2, 3, "A105 Nunes"]];
    const group = { spec: { name: "Inginerie civilă", degree: "bachelor" as const }, year: 3, name: "131 a", series: "" };
    const table = readPrintedTable(cells, "III", () => [{ left: 1, right: 2, group }], "all", civilCell, { isDetail: civilDetail });
    expect(table.entries).toMatchObject([{ courseName: "C-ții din lemn", room: "A105", teacher: "Nunes", weeks: "8-13" }]);
  });

  it("keeps assigned Electronics slots and offers the separate elective labs to eligible groups", () => {
    const grid = new Grid("Master");
    const put = (row: number, col: number, text: string, colSpan = 1) => grid.add({ row, col, text, colSpan, rowSpan: 1 });
    put(1, 3, "1 ETcTI MA", 2); put(1, 6, "Optionale MA an 1 sem 1");
    put(2, 3, "1 ID 33"); put(2, 4, "1 ESI 31"); put(2, 6, "MSS");
    put(3, 3, "sg.1.1"); put(3, 4, "sg.1.1"); put(3, 6, "2sg.");
    for (let i = 0; i < 4; i++) put(4 + i, 2, (8 + 2 * i) + "-" + (10 + 2 * i));
    put(4, 3, "MSS(c) Dep Mate"); put(5, 3, "MSS(l) Dep Mate");
    put(4, 6, "MSS(c) Dep Mate"); put(5, 6, "MSS(l) Dep Mate"); put(6, 6, "MSS(l) Dep Mate");
    const s: DiscoveredSource = { url: "https://etc.upt.ro/", kind: "timetable", label: "Master an I", context: "",
      format: "gsheet", academicYear: "2026-2027", semester: 1 };
    const table = etcAdapter.normalize!(parseTimetable(grid), s, grid)!;
    const forProgramme = (code: string) => table.entries.filter((e) => e.groups.some((i) => table.groups[i].spec.code === code));
    expect(forProgramme("ID")).toHaveLength(2);
    expect(forProgramme("ID").every((e) => !e.publishedOptional && !e.isSlotOption)).toBe(true);
    expect(forProgramme("ESI")).toHaveLength(3);
    expect(forProgramme("ESI").filter((e) => e.kind === "lab")).toMatchObject([
      { isSlotOption: true, publishedOptional: true }, { isSlotOption: true, publishedOptional: true },
    ]);
  });
});

describe("text helpers", () => {
  it("parses the hour formats used across faculties", () => {
    expect(parseTimeRange("08-09")).toEqual({ startMin: hm(8), endMin: hm(9) });
    expect(parseTimeRange("8 - 10")).toEqual({ startMin: hm(8), endMin: hm(10) });
    expect(parseTimeRange("20:21")).toEqual({ startMin: hm(20), endMin: hm(21) });
    expect(parseTimeRange("08:00-10:00")).toEqual({ startMin: hm(8), endMin: hm(10) });
    expect(parseTimeRange("1.1")).toBeNull();
    expect(parseTimeRange("Luni")).toBeNull();
  });

  it("builds the acronyms labs are listed under", () => {
    expect(acronym("Sisteme de operare 2")).toBe("SO2");
    expect(acronym("Concepte fundamentale ale limbajelor de programare")).toBe("CFLP");
    expect(acronym("Programare concurenta si bazata pe evenimente")).toBe("PCBE");
    expect(acronym("Cloud Computing and Internet of Things")).toBe("CCIT");
  });

  it("reads the study year from headings", () => {
    expect(parseStudyYear("ANUL III - SEM. I 2026/2027")).toBe(3);
    expect(parseStudyYear("3rd Year, 1st Semester 2026/2027")).toBe(3);
    expect(parseStudyYear("IM an IV")).toBe(4);
    expect(parseStudyYear("Orar an universitar 2026-2027")).toBeNull();
  });
});

describe("parseCellText", () => {
  it("handles the AC style: name (type) teacher / room", () => {
    const p = parseCellText("Management și marketing (c)  I. Tăucean\namf. A0 MPT");
    expect(p).toMatchObject({ name: "Management și marketing", kind: "course", teacher: "I. Tăucean", room: "A0 MPT", weeks: "all" });
  });

  it("treats a bare acronym with a room as a lab of that course", () => {
    expect(parseCellText("PM (l) B413")).toMatchObject({ name: "PM", abbr: "PM", kind: "lab", room: "B413", teacher: null });
    expect(parseCellText("CFLP (l) 301CP")).toMatchObject({ abbr: "CFLP", room: "301CP" });
  });

  it("extracts week ranges and ignores hour-load annotations", () => {
    expect(parseCellText("MM (s) sapt 1-7\nsala SPM205")).toMatchObject({ kind: "seminar", weeks: "1-7", room: "SPM205" });
    expect(parseCellText("Sisteme mobile si aplicatii (c)  M. Marcu\nsala 303CP 2h/12sapt")).toMatchObject({ weeks: "all", room: "303CP", teacher: "M. Marcu" });
  });

  it("handles the MPT comma style with explicit acronym and parity flag", () => {
    expect(parseCellText("Bazele economiei 1 (BE1), curs, A0, M. Vartolomei")).toMatchObject({
      name: "Bazele economiei 1",
      abbr: "BE1",
      kind: "course",
      room: "A0",
      teacher: "M. Vartolomei",
    });
    expect(parseCellText("Fiz, lab, C301B ET, O.Irizoiu, p")).toMatchObject({ kind: "lab", weeks: "even", teacher: "O. Irizoiu" });
  });

  it("handles the FSC style with leading group and parity qualifiers", () => {
    expect(parseCellText("Sapt. para Sociologia opiniei publice (c) Dragomir Ca3")).toMatchObject({
      name: "Sociologia opiniei publice",
      weeks: "even",
      room: "Ca3",
      teacher: "Dragomir",
    });
    expect(parseCellText("Gr. F Gândire critică (s) Băiaș C303")).toMatchObject({ name: "Gândire critică", kind: "seminar", room: "C303" });
  });

  it("ends an untyped title at its room, and reads the acronym and the lecturer around it", () => {
    // Robotică, year 1, Friday: shown as "Algebra liniara · Altele" with no lecturer, a second
    // course next to "ALGAD · Seminar".
    expect(parseCellText("Algebra liniara, geometrie analitica si diferentiala- ALGAD sala M306 Sl. univ. dr. mat Loredana CIURDARIU (ȚÎRȚÎRĂU)")).toMatchObject({
      name: "Algebra liniara, geometrie analitica si diferentiala", abbr: "ALGAD", room: "M306", teacher: "Sl. univ. dr. mat Loredana CIURDARIU (ȚÎRȚÎRĂU)",
    });
    // The room was left in the course name: "Germana sala 304 Facultatea de Chimie", "Ora de TUTORIAT sala".
    expect(parseCellText("Germana sala 304 Facultatea de Chimie")).toMatchObject({ name: "Germana", room: "304 Chimie" });
    expect(parseCellText("Franceza/ Engleza sala M201/ sala N 211")).toMatchObject({ name: "Franceza/ Engleza", room: "M201/ N 211" });
    expect(parseCellText("Ora de TUTORIAT sala M306")).toMatchObject({ name: "Ora de TUTORIAT", room: "M306" });
    expect(parseCellText("Modelare Simulare 3D (2C + 2P) sala 409/SPM 225")).toMatchObject({ name: "Modelare Simulare 3D (2C + 2P)", room: "409/SPM 225" });
    expect(parseCellText("Programare Java - PJ (c) sapt. 1-10 R. ROBU - sala ASPC")).toMatchObject({ name: "Programare Java", abbr: "PJ", teacher: "R. ROBU", room: "ASPC", weeks: "1-10" });
    // "Sală" that is not followed by a room is no place to cut, and a semicolon still decides first.
    expect(parseCellText("Analiza datelor prin satelit şi Sală digitalizarea mediului C310").name).toContain("digitalizarea mediului");
    expect(parseCellText("Etică și integritate academică Săpt. 1 / 5 / 9; Săpt.13 (14-15) Reisz Sală H4").name).toBe("Etică și integritate academică");
  });

  it("takes a lecture's room from the brackets after it, not from the note about its lab", () => {
    // Mecanică, year 1. The Fizica lecture was shown in "303 A si 303 B corpul C" (where the lab
    // is, in another faculty's building) and the campus page looked for that as a room.
    expect(parseCellText("Fizica - curs (sala N 301) SL. dr. Irizoiu Oana Evaluare - D; 4 puncte credit Laboratorul este la Facultatea de Fac. Electronica, sala 303 A si 303 B corpul C (Irizoiu Oana)"))
      .toMatchObject({ name: "Fizica", kind: "course", room: "N 301" });
    expect(parseCellText("Introducere în Știința Materialelor (C) - curs (sala N 110) Uțu Dragoș Evaluare - E; 6 puncte credit Sala laborator N214 si M214"))
      .toMatchObject({ kind: "course", room: "N 110" });
    expect(parseCellText("M.A.C.I. (L) (Sala 207-RM et. 2)")).toMatchObject({ kind: "lab", room: "207-RM et. 2" });
  });

  it("reads the room of a class written \"title - sala N 210\", and does not take a lecturer in brackets for an acronym", () => {
    // Mecanică, year 1: the tutoring and revision lectures had no room and no way to them.
    expect(parseCellText("CURS TUTORIAT - sala N 210")).toMatchObject({ name: "CURS TUTORIAT", kind: "course", room: "N 210" });
    expect(parseCellText("Curs recapitulare FIZICA - sala N 110")).toMatchObject({ name: "Curs recapitulare FIZICA", room: "N 110" });
    expect(parseCellText("Limbi straine - Germana (Cartis) - Sala N 212")).toMatchObject({ name: "Limbi straine - Germana (Cartis)", abbr: null, room: "N 212" });
    expect(parseCellText("Fizica (Fiz) (c) A. Palcu A0")).toMatchObject({ name: "Fizica", abbr: "Fiz" });
  });

  it("reads \"odd weeks\" and \"even weeks\" as the English sheets write them", () => {
    // Calculatoare in English, year 2: "Computer Architecture" showed every Thursday, in room
    // "ASPC - odd". Year 3: "Artificial Intelligence Fundamentals", every week instead of even weeks.
    expect(parseCellText("Computer Architecture (c) F. Opritoiu room ASPC - odd weeks")).toMatchObject({ weeks: "odd", room: "ASPC", teacher: "F. Opritoiu" });
    expect(parseCellText("Artificial Intelligence Fundamentals (c) C. Cernazanu, even weeks - room ASPC")).toMatchObject({ weeks: "even", room: "ASPC", teacher: "C. Cernazanu" });
    expect(parseCellText("Even and odd functions (c) A. Pop room A204")).toMatchObject({ name: "Even and odd functions", weeks: "all" });
  });

  it("takes the kind of a class from \"(2C)\", \"(2L)\", \"(2P)\" when that is all the sheet says", () => {
    // Robotică, master: every class was "Altele" with "(2C)" in its name, so a subject's
    // lecture and lab were two unrelated activities.
    expect(parseCellText("Inteligență artificială pentru robotică (2C) sala 411")).toMatchObject({ name: "Inteligență artificială pentru robotică", kind: "course", room: "411" });
    expect(parseCellText("Inteligență artificială pentru robotică (2L) sala 411")).toMatchObject({ name: "Inteligență artificială pentru robotică", kind: "lab", room: "411" });
    expect(parseCellText("Modelare 3D ( 2P) sala 409")).toMatchObject({ name: "Modelare 3D", kind: "project", room: "409" });
    // Several kinds in one cell cannot be told apart: left as it is.
    expect(parseCellText("Modelare Simulare 3D (2C + 2P) sala 409/SPM 225")).toMatchObject({ name: "Modelare Simulare 3D (2C + 2P)", kind: "other" });
  });

  it("keeps a building named before the room out of the lecturer's name", () => {
    // ETcTI, year 3: "IV(c) M.Lascu Mecanica M304". The lecturer was shown as "M. Lascu Mecanica".
    expect(parseCellText("IV(c) M.Lascu Mecanica M304")).toMatchObject({ name: "IV", kind: "course", teacher: "M. Lascu", room: "M304 Mecanica" });
    expect(parseCellText("Microec(c) A. Artene Mecanica M304")).toMatchObject({ teacher: "A. Artene", room: "M304 Mecanica" });
    // A subject of that name is still a subject, and a room without a building stays as it is.
    expect(parseCellText("Mecanica (c) I. Popescu M304")).toMatchObject({ name: "Mecanica", teacher: "I. Popescu", room: "M304" });
    expect(parseCellText("Mecanica fluidelor (c) A. Ionescu N210")).toMatchObject({ name: "Mecanica fluidelor", teacher: "A. Ionescu", room: "N210" });
    // FSC: the room repeated in brackets with its building hid the lecturer.
    expect(parseCellText("Noțiuni de management și marketing (c) Tămășilă M106 (MPT - M106)")).toMatchObject({ teacher: "Tămășilă", room: "M106" });
  });

  it("keeps the building written beside a room with the room, never as the teacher", () => {
    // Cells from the 2026-27 ETcTI, MEC and RIA timetables.
    expect(parseCellText("Unif. fiz. (c), A2 Chimie")).toMatchObject({ name: "Unif. fiz.", kind: "course", room: "A2 Chimie", teacher: null });
    expect(parseCellText("LP1(c) P. Serafin, A2 Chimie, s1-10")).toMatchObject({ teacher: "P. Serafin", room: "A2 Chimie", weeks: "1-10" });
    expect(parseCellText("SwEA(c) S.Mischie A2 Chimie")).toMatchObject({ teacher: "S. Mischie", room: "A2 Chimie" });
    expect(parseCellText("Pedagogie (c) H0 Hidrotehnica")).toMatchObject({ room: "H0 Hidrotehnica", teacher: null });
    expect(parseCellText("TTI(c) H. Balta A2CH")).toMatchObject({ room: "A2 Chimie", teacher: "H. Balta" });
    expect(parseCellText("NM II (C), Orologerie building, Room 206")).toMatchObject({ kind: "course", room: "206 Orologerie", teacher: null });
    expect(parseCellText("TM (L) SPM parter P01 Marius Pop‐Călimanu")).toMatchObject({ kind: "lab", room: "P01 SPM", teacher: "Marius Pop‐Călimanu" });
    expect(parseCellText("GDDT (L) Salcianu L. Sala 225 A (SPM)")).toMatchObject({ room: "225 A SPM", teacher: "Salcianu L." });
    expect(parseCellText("RM (L) Orologerie parter Murariu")).toMatchObject({ kind: "lab", room: "Orologerie", teacher: "Murariu" });
    expect(parseCellText("M (L) Orologerie, etaj I Dorin Simoiu")).toMatchObject({ room: "Orologerie", teacher: "Dorin Simoiu" });
    expect(parseCellText("MCS (L) Orologerie 405 Stoia Andreea")).toMatchObject({ room: "Orologerie 405", teacher: "Stoia Andreea" });
    expect(parseCellText("M (S) 112 Orologerie")).toMatchObject({ kind: "seminar", room: "112 Orologerie" });
    expect(parseCellText("MEF (L) Clădirea Orologerie Sala 206 Orologerie")).toMatchObject({ room: "206 Orologerie", teacher: null });
    // "Chimie Centru" is another building than the faculty's: it is not shortened to "Chimie".
    expect(parseCellText("Etică (c) Amf. C3 Sală (Chimie Centru)").room).not.toMatch(/Chimie$/);
    // A room that already names its building stays as written.
    expect(parseCellText("Management și marketing (c)  I. Tăucean\namf. A0 MPT")).toMatchObject({ room: "A0 MPT", teacher: "I. Tăucean" });
    expect(parseCellText("MM (s) sapt 1-7\nsala SPM205")).toMatchObject({ room: "SPM205" });
  });

  it("separates the lecturer written after the room", () => {
    expect(parseCellText("Materiale si nanomateriale (C)-MN sala M204 Conf. univ. dr. ing. Carmen OPRIȘ")).toMatchObject({
      name: "Materiale si nanomateriale", kind: "course", room: "M204", teacher: "Conf. univ. dr. ing. Carmen OPRIȘ",
    });
    expect(parseCellText("Chimie (C) sala M306 Prof.dr Ing. Narcis DUȚEANU")).toMatchObject({ room: "M306", teacher: "Prof.dr Ing. Narcis DUȚEANU" });
    expect(parseCellText("Physics (C) room C 301B Prof. univ. dr. ing. Adrian PALCU")).toMatchObject({ room: "C 301B", teacher: "Prof. univ. dr. ing. Adrian PALCU" });
    expect(parseCellText("Economie generală (C) sala M 204 Conf.dr.ec. M. Vartolomei (săpt. 1-10)")).toMatchObject({ room: "M 204", teacher: "M. Vartolomei", weeks: "1-10" });
    expect(parseCellText("AM (s) - sala A110 A. Gaina")).toMatchObject({ kind: "seminar", room: "A110", teacher: "A. Gaina" });
    expect(parseCellText("Germana (s) - sala 304 CP A. Dascalu-Romitan")).toMatchObject({ room: "304 CP", teacher: "A. Dascalu-Romitan" });
    expect(parseCellText("BMS (c) sala MEC-N303 C. Zimbru")).toMatchObject({ room: "MEC-N303", teacher: "C. Zimbru" });
    // "impar" and "par" after the room say which weeks, not where.
    expect(parseCellText("IA (L) sala 311 impar")).toMatchObject({ kind: "lab", room: "311", weeks: "odd" });
    expect(parseCellText("IA (L) sala 311 par")).toMatchObject({ room: "311", weeks: "even" });
    // FSC writes the surname first: "Dejica D." teaches in Ca3.
    expect(parseCellText("Mediere lingvistică și culturală E (c) Dejica D. Ca3")).toMatchObject({ teacher: "Dejica D.", room: "Ca3" });
    expect(parseCellText("Fundamente ale ştiinţelor comunicării (c) Suciu L. Ca3")).toMatchObject({ teacher: "Suciu L.", room: "Ca3" });
  });

  it("reads how many weeks a course runs, however the faculty writes it", () => {
    // MEC: "primele 10 săptămâni" in year 2, shortened to "10 săpt" in years 3 and 4.
    expect(parseCellText("Metode numerice II (MEF) (curs) 10 săpt")).toMatchObject({ kind: "course", weeks: "1-10" });
    expect(parseCellText("Economie Generală (curs – M 204) 10 săpt.").weeks).toBe("1-10");
    expect(parseCellText("Bazele sistemelor automate (curs – M 204) 7 săpt.").weeks).toBe("1-7");
    expect(parseCellText("Simulări numerice (C), Sala M107 sapt. (1-11)")).toMatchObject({ weeks: "1-11", room: "M107" });
    expect(parseCellText("GAC (L) s:1- 9 sala 218").weeks).toBe("1-9");
    expect(parseCellText("Comunicare(c) S8-S14 A316")).toMatchObject({ weeks: "8-14", room: "A316" });
    // A slot list keeps its room: "- A315" is not an acronym.
    expect(parseCellText("AAP (l) - A315 Luni 16-18 (Sgr 1), 18-20 (Sgr. 2)")).toMatchObject({ room: "A315", abbr: "AAP" });
    expect(parseCellText("TAS (l) - ASPC 1 Marti 8-10 (Sgr 1), 10-12 (Sgr 2)").room).toBe("ASPC 1");
    expect(parseCellText("PS 3 (S) 401 A,B,C ultimele 7 sapt.")).toMatchObject({ weeks: "8-14", teacher: null });
    expect(parseCellText("Proiectare asist de calc. 2 (C) Keller 401 A,B,C (primele 7 sapt.)")).toMatchObject({ weeks: "1-7", room: "401 A,B,C", teacher: "Keller" });
    expect(parseCellText("Măsurări și traductoare (c) C. Dughir s1-s10 ,sala ASPC")).toMatchObject({ weeks: "1-10", room: "ASPC", teacher: "C. Dughir" });
    expect(parseCellText("Construcţii Civile (CC), curs, [S1-S12]*, M014, L. Fechete")).toMatchObject({ weeks: "1-12", room: "M014", teacher: "L. Fechete" });
    expect(parseCellText("Ingineria suprafeţelor (IS), Curs, SPM104, Prof. Uţu, [S1-S10]")).toMatchObject({ weeks: "1-10", room: "SPM104", teacher: "Prof. Uţu" });
    expect(parseCellText("- APA (C) S1-S10 -").weeks).toBe("1-10");
    expect(parseCellText("Etica si integritate academica - Saptamana 1 - 7 - sala LV Stanici M.").weeks).toBe("1-7");
    // Seven weeks of lab and seven of project fill the semester.
    expect(parseCellText("DEA (laborator 7 săpt + proiect 7 săpt) M206 L Mihon").weeks).toBe("all");
    // A range cut off by the end of the cell says nothing.
    expect(parseCellText("GAC (L) s:1-").weeks).toBe("all");
    // An hour load is not a week limit.
    expect(parseCellText("Sisteme mobile si aplicatii (c)  M. Marcu\nsala 303CP 2h/12sapt").weeks).toBe("all");
    expect(parseCellText("Proiect (p) 14 săpt x 2h").weeks).toBe("all");
  });

  it("keeps untyped cells as-is", () => {
    expect(parseCellText("TUTORIERE Ca3")).toMatchObject({ name: "TUTORIERE", kind: "other", room: "Ca3" });
  });
});

describe("parseSlotNote", () => {
  it("reads room-first slot lists with a track filter", () => {
    const n = parseSlotNote("PW (l)   [C]   sala B528b   Marti 12-14\nsala B515   Vineri 10-12,   sala A305  Luni 14-16")!;
    expect(n.abbr).toBe("PW");
    expect(n.tracks).toEqual(["C"]);
    expect(n.slots).toEqual([
      { day: 2, startMin: hm(12), endMin: hm(14), room: "B528b" },
      { day: 5, startMin: hm(10), endMin: hm(12), room: "B515" },
      { day: 1, startMin: hm(14), endMin: hm(16), room: "A305" },
    ]);
  });

  it("reads room-last slot lists (English sheets)", () => {
    const n = parseSlotNote("DMD (l) Tue 12-14, 14-16 room B414\nWed 12-14, 14-16, 16-18 room B414")!;
    expect(n.slots).toHaveLength(5);
    expect(n.slots[0]).toEqual({ day: 2, startMin: hm(12), endMin: hm(14), room: "B414" });
    expect(n.slots[4]).toMatchObject({ day: 3, startMin: hm(16), endMin: hm(18) });
  });

  it("ignores text that is not an activity", () => {
    expect(parseSlotNote("laborator saptamanal de 2 ore")).toBeNull();
  });
});

describe("loadWorkbook", () => {
  it("uses the visible rows and columns of merged cells", async () => {
    const book = new ExcelJS.Workbook();
    const sheet = book.addWorksheet("Timetable");
    sheet.getColumn(2).hidden = true;
    sheet.getRow(2).hidden = true;
    sheet.getCell("B1").value = "Hidden group";
    sheet.getCell("A2").value = "Hidden hour";
    sheet.mergeCells("B2:D4");
    sheet.getCell("B2").value = "Shared lecture";
    sheet.getCell("E5").value = "Next group";

    const [grid] = await loadWorkbook(Buffer.from(await book.xlsx.writeBuffer()));
    expect(grid.cells).toEqual([
      { row: 2, col: 2, rowSpan: 2, colSpan: 2, text: "Shared lecture" },
      { row: 4, col: 4, rowSpan: 1, colSpan: 1, text: "Next group" },
    ]);
    expect(grid.at(3, 3)?.text).toBe("Shared lecture");
  });
});

describe("parseTimetable", () => {
  it("parses a synthetic grid: merged lectures, continuation rows, day wrap", () => {
    const g = new Grid("An 2");
    g.add({ row: 1, col: 3, rowSpan: 1, colSpan: 4, text: "ANUL II - SEM. I 2026/2027" });
    g.add({ row: 2, col: 3, rowSpan: 1, colSpan: 2, text: "CALCULATOARE (C)" });
    g.add({ row: 2, col: 5, rowSpan: 1, colSpan: 2, text: "TEHNOLOGIA INFORMATIEI (TI)" });
    ["1.1", "1.2", "1.1", "1.2"].forEach((name, i) => g.add({ row: 3, col: 3 + i, rowSpan: 1, colSpan: 1, text: name }));
    // Two day blocks of four hours each; the hour sequence restarting marks a new day.
    ["08-09", "09-10", "10-11", "11-12", "08-09", "09-10", "10-11", "11-12"].forEach((t, i) =>
      g.add({ row: 4 + i, col: 2, rowSpan: 1, colSpan: 1, text: t }),
    );
    g.add({ row: 4, col: 3, rowSpan: 1, colSpan: 4, text: "Structuri de date si algoritmi (c) A. Ionescu" });
    g.add({ row: 5, col: 3, rowSpan: 1, colSpan: 4, text: "sala A101" });
    g.add({ row: 6, col: 3, rowSpan: 2, colSpan: 1, text: "SDA (l) B418a" });
    g.add({ row: 8, col: 5, rowSpan: 2, colSpan: 2, text: "Electronica digitala (c) D. Pop\nsala A204" });

    const t = parseTimetable(g);
    expect(t.year).toBe(2);
    expect(t.groups.map((x) => `${x.track}/${x.name}`)).toEqual([
      "CALCULATOARE (C)/1.1",
      "CALCULATOARE (C)/1.2",
      "TEHNOLOGIA INFORMATIEI (TI)/1.1",
      "TEHNOLOGIA INFORMATIEI (TI)/1.2",
    ]);
    const lecture = t.entries.find((e) => e.kind === "course" && e.day === 1)!;
    expect(lecture).toMatchObject({ courseName: "Structuri de date si algoritmi", startMin: hm(8), endMin: hm(10), room: "A101", groups: [0, 1, 2, 3] });
    const lab = t.entries.find((e) => e.kind === "lab")!;
    // The acronym resolves to the lecture it belongs to.
    expect(lab).toMatchObject({ courseName: "Structuri de date si algoritmi", courseAbbr: "SDA", startMin: hm(10), endMin: hm(12), groups: [0] });
    expect(t.entries.find((e) => e.day === 2)).toMatchObject({ courseName: "Electronica digitala", startMin: hm(8), endMin: hm(10), groups: [2, 3] });
  });

  it("gives a lecture that gets shorter during the term its length in each part", () => {
    // MPT, "IM an I", Thursday 16-19: three hours in weeks 1-4, two from week 5.
    const g = new Grid("IM an I");
    g.add({ row: 1, col: 3, rowSpan: 1, colSpan: 2, text: "ANUL I - SEM. I 2026/2027" });
    ["1.1", "1.2"].forEach((name, i) => g.add({ row: 3, col: 3 + i, rowSpan: 1, colSpan: 1, text: name }));
    ["16-17", "17-18", "18-19", "16-17", "17-18", "18-19"].forEach((time, i) => g.add({ row: 4 + i, col: 2, rowSpan: 1, colSpan: 1, text: time }));
    g.add({ row: 4, col: 3, rowSpan: 3, colSpan: 2, text: "Fizica (Fiz), curs, A0, A.Palcu, 3 h sapt.1-4, 2 h sapt. 5-12" });
    g.add({ row: 7, col: 3, rowSpan: 3, colSpan: 2, text: "Limbaje de programare (LP), curs, A0, sapt.1-8 (3 h), sapt. 9-10 (2 h), M.Pop" });
    const t = parseTimetable(g);
    const parts = (name: string) => t.entries.filter((e) => e.courseName.startsWith(name)).map((e) => `${e.weeks} ${e.startMin / 60}-${e.endMin / 60} ${e.kind} ${e.room} ${e.teacher}`);
    // In week 9 the student was kept until 19:00 for a lecture that ends at 18:00.
    expect(parts("Fizica")).toEqual(["1-4 16-19 course A0 A. Palcu", "5-12 16-18 course A0 A. Palcu"]);
    expect(parts("Limbaje")).toEqual(["1-8 16-19 course A0 M. Pop", "9-10 16-18 course A0 M. Pop"]);
    // The "2" of "2 h" is an hour count, not week 2.
    expect(parseCellText("Fizica (Fiz), curs, A0, A.Palcu, 3 h sapt.1-4, 2 h sapt. 5-12").weeks).toBe("1-4,5-12");
    expect(hourLoads("Controlere Logice Programabile (s:1-8 2h, s:9-12 3h), curs")).toEqual([{ weeks: "1-8", hours: 2 }, { weeks: "9-12", hours: 3 }]);
    expect(hourLoads("Sisteme mobile si aplicatii (c) M. Marcu sala 303CP 2h/12sapt")).toEqual([]);
    expect(hourLoads("MM (s) sapt 1-7 sala SPM205")).toEqual([]);
  });

  it("marks an ETcTI class that shares its slot with a dash as held every other week", () => {
    // Year 3, Wednesday 10-12: "TTI(l)" over "-" for subgroup 1.1, "-" over "TTI(l)" for 2.2.
    const g = new Grid("An III");
    g.add({ row: 1, col: 3, rowSpan: 1, colSpan: 2, text: "ETcTI" });
    ["sg.1.1", "sg.2.2"].forEach((name, i) => g.add({ row: 3, col: 3 + i, rowSpan: 1, colSpan: 1, text: name }));
    ["8-10", "10-12", "12-14", "8-10", "10-12", "12-14"].forEach((time, i) => g.add({ row: 4 + i, col: 2, rowSpan: 1, colSpan: 1, text: time }));
    g.add({ row: 5, col: 3, rowSpan: 1, colSpan: 1, text: "TTI(l)\n-" });
    g.add({ row: 5, col: 4, rowSpan: 1, colSpan: 1, text: "-\nTTI(l)" });
    g.add({ row: 6, col: 3, rowSpan: 1, colSpan: 2, text: "TTI(c) A. Pop A316" });
    const table = etcAdapter.normalize!(parseTimetable(g), { label: "Licență An III", url: "https://example.org", context: "", kind: "timetable", format: "gsheet", academicYear: "2026-2027", semester: 1 } as DiscoveredSource, g)!;
    const labs = table.entries.filter((e) => e.kind === "lab");
    // Not weekly, and not a parity the sheet does not state: shown every week with a note.
    expect(labs.map((e) => [e.courseName, e.weeks])).toEqual([["TTI", "alt"], ["TTI", "alt"]]);
    expect(table.entries.find((e) => e.kind === "course")?.weeks).toBe("all");
    expect(weekMatches("alt", 8) && weekMatches("alt", 9)).toBe(true);
    expect(weekMatches("1-7&alt", 8)).toBe(false);
    expect(describeWeeks("alt", "ro")).toBe("o dată la două săptămâni (orarul nu spune în care: verifică la grupă)");
    expect(describeWeeks("1-7&alt", "en")).toContain("every other week");
  });

  it("reports sheets that are not timetables", () => {
    const g = new Grid("Legenda sali");
    g.add({ row: 1, col: 1, rowSpan: 1, colSpan: 1, text: "Sali" });
    const t = parseTimetable(g);
    expect(t.entries).toHaveLength(0);
    expect(t.warnings[0]).toMatch(/not a timetable/);
  });

  it("parses the real AC workbook", async () => {
    const grids = await loadWorkbook(fixture("ac-cti-2026-27-sem1.xlsx"));
    expect(grids.map((g) => g.name)).toContain("An 3");

    const year3 = parseTimetable(grids.find((g) => g.name === "An 3")!);
    expect(year3.year).toBe(3);
    expect(year3.groups).toHaveLength(12);
    expect(year3.groups[0]).toMatchObject({ track: "CALCULATOARE (C)", name: "1.1" });
    expect(year3.groups[6]).toMatchObject({ track: "TEHNOLOGIA INFORMATIEI (TI)", name: "1.1" });

    // A lecture shared by both specializations, Wednesday 08–10.
    const pm = year3.entries.find((e) => e.courseName === "Proiectarea cu microprocesoare" && e.kind === "course")!;
    expect(pm).toMatchObject({ day: 3, startMin: hm(8), endMin: hm(10), teacher: "M. Popa" });
    expect(pm.groups).toHaveLength(12);

    // A lecture typed over two unmerged rows ("… (c) D. Stanescu" / "sala A204").
    const ci = year3.entries.find((e) => e.courseName === "Circuite integrate" && e.kind === "course")!;
    expect(ci).toMatchObject({ day: 2, startMin: hm(10), endMin: hm(12), room: "A204" });
    expect(ci.groups).toEqual([0, 1, 2, 3, 4, 5]);

    // Labs listed in the side column become alternative slots, filtered by track.
    const piLabs = year3.entries.filter((e) => e.courseAbbr === "PI" && e.kind === "lab");
    expect(piLabs.length).toBeGreaterThan(3);
    expect(piLabs.every((e) => e.isSlotOption && e.courseName === "Prelucrarea imaginilor")).toBe(true);
    const ahaLabs = year3.entries.filter((e) => e.courseAbbr === "AHA" && e.kind === "lab");
    expect(ahaLabs.every((e) => e.groups.every((i) => year3.groups[i].track?.includes("TI")))).toBe(true);

    // The second row may open with the weeks in brackets: "… (c) I. Tatai" / "(saptamanile 1-10) sala A2 - Chimie".
    // It is still the same two-hour lecture, not a class of its own called "( ) sala A2 - Chimie".
    const year1 = parseTimetable(grids.find((g) => g.name === "An 1")!);
    const tuesday = year1.entries.filter((e) => e.day === 2 && e.rawText.includes("Tatai") && e.rawText.includes("A2"));
    expect(tuesday).toEqual([expect.objectContaining({ courseName: "Electrotehnica", kind: "course", startMin: hm(14), endMin: hm(16), weeks: "1-10", room: "A2 - Chimie", teacher: "I. Tatai" })]);
    expect(year1.entries.filter((e) => /^\(\s*(?:s[aă]pt|weeks?)/i.test(e.rawText))).toEqual([]);
    const year2english = parseTimetable(grids.find((g) => g.name === "An 2 Eng")!);
    expect(year2english.entries.find((e) => e.rawText.includes("Precup") && e.kind === "course"))
      .toMatchObject({ day: 4, startMin: hm(9), endMin: hm(11), weeks: "5-14", room: "A204" });
    expect(year2english.entries.filter((e) => /^\(\s*(?:s[aă]pt|weeks?)/i.test(e.rawText))).toEqual([]);

    // Master's sheets have no group header: one implicit group.
    const ml = parseTimetable(grids.find((g) => g.name === "An 1 ML")!);
    expect(ml.groups).toEqual([{ track: null, name: "", col: 3 }]);
    expect(ml.entries.find((e) => e.courseName === "Deep Learning" && e.kind === "course")).toMatchObject({ day: 3, startMin: hm(18) });
  });

  it("maps AC sheets onto specializations and series", async () => {
    const grids = await loadWorkbook(fixture("ac-cti-2026-27-sem1.xlsx"));
    const source = { url: "x", label: "C-RO", context: "", kind: "timetable", format: "xlsx", academicYear: "2026-2027", semester: 1 } as DiscoveredSource;
    const y1 = acAdapter.normalize!(parseTimetable(grids.find((g) => g.name === "An 1")!), source)!;
    expect(y1.groups[0]).toMatchObject({ spec: { code: "CTI" }, year: 1, series: "Seria 1 (C)", name: "1.1" });
    const subgroups = ["1.1", "1.2", "2.1", "2.2", "3.1", "3.2"];
    for (const series of ["Seria 1 (C)", "Seria 2 (D)"]) {
      expect(y1.groups.filter((g) => g.series === series).map((g) => g.name)).toEqual(subgroups);
    }
    const y2 = acAdapter.normalize!(parseTimetable(grids.find((g) => g.name === "An 2")!), source)!;
    expect(y2.groups.filter((g) => g.spec.code === "TI").map((g) => g.name)).toEqual(subgroups);
    const ti32 = y2.groups.findIndex((g) => g.spec.code === "TI" && g.name === "3.2");
    expect(y2.entries.filter((e) => e.day === 1 && e.startMin === hm(18) && e.groups.includes(ti32)))
      .toEqual([expect.objectContaining({ courseAbbr: "SDA", kind: "lab", room: "A305" })]);
    expect(y2.entries.filter((e) => e.day === 1 && e.startMin === hm(18) && e.room === "B521")
      .map((e) => e.groups.map((i) => y2.groups[i].name))).toEqual([["3.1"]]);
    const y3 = acAdapter.normalize!(parseTimetable(grids.find((g) => g.name === "An 3")!), source)!;
    expect(new Set(y3.groups.map((g) => g.spec.code))).toEqual(new Set(["C", "TI"]));
    for (const year of [1, 2, 3, 4]) {
      const english = acAdapter.normalize!(parseTimetable(grids.find((g) => g.name === `An ${year} Eng`)!), source)!;
      expect(english.entries.length).toBeGreaterThan(0);
      expect(english.groups.every((g) => g.year === year && g.spec.name === "Calculatoare" && g.spec.code === "C-EN" && g.spec.language === "EN")).toBe(true);
    }
    const se = acAdapter.normalize!(parseTimetable(grids.find((g) => g.name === "An 1 SE")!), source)!;
    expect(se.groups[0]).toMatchObject({ spec: { name: "Software Engineering", degree: "master" }, year: 1 });
    expect(acAdapter.normalize!(parseTimetable(grids.find((g) => g.name === "Legenda sali")!), source)).toBeNull();
  });

  it("parses a real FSC workbook with labelled days and two-hour rows", async () => {
    const grids = await loadWorkbook(fixture("fsc-crp-2026-27-sem1.xlsx"));
    const t = parseTimetable(grids[0]);
    expect(t.year).toBe(1);
    expect(t.groups.map((g) => g.name)).toEqual(["1 franceză", "2 germană"]);
    const tutoring = t.entries.find((e) => e.courseName === "TUTORIERE")!;
    expect(tutoring).toMatchObject({ day: 4, startMin: hm(10), endMin: hm(12), room: "Ca3", groups: [0, 1] });
    expect(t.entries.some((e) => e.weeks === "odd") && t.entries.some((e) => e.weeks === "even")).toBe(true);
  });

  it("parses a real published Google Sheet (ETcTI) from its HTML table", () => {
    const grids = loadHtmlTables(fixture("etc-an1-2026-27-sem1.html").toString("utf8"));
    expect(grids).toHaveLength(1);
    const t = parseTimetable(grids[0]);
    expect(t.groups.filter((g) => g.track === "I ETcTI SERIA A").map((g) => g.name)).toEqual(["1.1", "1.2", "2.1", "2.2", "3.1", "3.2", "3.3"]);
    expect(t.entries.length).toBeGreaterThan(100);
    expect(t.entries.every((e) => e.day >= 1 && e.day <= 6 && e.endMin > e.startMin)).toBe(true);
    const table = etcAdapter.normalize!(t, { label: "Licență an I" } as DiscoveredSource, grids[0])!;
    expect(new Set(table.groups.map((g) => g.spec.code))).toEqual(new Set(["ETcTI", "TST-EN"]));
  });
});

describe("printed and interactive timetables", () => {
  it("uses subgroup parity, shared lectures and the clock next to each column", () => {
    const cells: Box[] = [
      [1, 0, 2, 1, "impară"], [2, 0, 3, 1, "pară"], [4, 0, 5, 1, "Grupa 2"],
      [0, 1, 1, 2, "8-9"], [0, 2, 1, 3, "9-10"], [0, 3, 1, 4, "10-11"],
      [3, 1, 4, 2, "14-15"], [3, 2, 4, 3, "15-16"], [3, 3, 4, 4, "16-17"],
      [1, 1, 3, 2, "Algebră (c)"], [1, 2, 2, 4, "Fizică (l)"], [4, 2, 5, 4, "Mecanică (s)"],
    ];
    const table = readPrintedTable(cells, "Anul I", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: "Inginerie", degree: "bachelor" }, year: 1, series: "", name: labels[0] === "Grupa 2" ? "2" : "1",
    })), "1-7");
    expect(table.groups.map((g) => g.name)).toEqual(["1", "2"]);
    expect(table.entries).toEqual(expect.arrayContaining([
      expect.objectContaining({ courseName: "Algebră", day: 1, startMin: hm(8), endMin: hm(9), weeks: "1-7", groups: [0] }),
      expect.objectContaining({ courseName: "Fizică", day: 1, startMin: hm(9), endMin: hm(11), weeks: "1-7&odd", groups: [0] }),
      expect.objectContaining({ courseName: "Mecanică", startMin: hm(15), endMin: hm(17), groups: [1] }),
    ]));
  });

  it("reads a class drawn across half of a two-hour row to the hour between", () => {
    // Construcții, year 2, Thursday: three-hour seminars on a grid of two-hour rows.
    const cells: Box[] = [
      [1, 0, 2, 1, "Grupa 1"], [2, 0, 3, 1, "Grupa 2"], [3, 0, 4, 1, "Grupa 3"],
      [0, 1, 1, 3, "8-10"], [0, 3, 1, 5, "10-12"], [0, 5, 1, 7, "12-14"],
      [1, 1, 2, 4, "Rezistenţa Materialelor 8-11 A308"], [2, 4, 3, 7, "Rezistenţa Materialelor 11-14 M201"],
      [3, 1, 4, 3, "Topografie (c)"], [3, 3, 4, 4, "TUTORIERE"],
    ];
    const table = readPrintedTable(cells, "Anul II", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: "Inginerie civilă", degree: "bachelor" }, year: 2, series: "", name: labels[0].slice(-1),
    })));
    const times = Object.fromEntries(table.entries.map((e) => [`${e.courseName.slice(0, 5)} ${table.groups[e.groups[0]].name}`, [e.startMin / 60, e.endMin / 60]]));
    // Construcții draws its rows to scale: a box in the upper half of 10-12 is an hour long.
    expect(times).toEqual({ "Rezis 1": [8, 11], "Rezis 2": [11, 14], "Topog 3": [8, 10], "TUTOR 3": [10, 11] });
  });

  it("does not make a group of its own out of a heading drawn one column too wide", () => {
    // Mecanică, year 2, Seria A (coordinates as read from the published PDF). "Grupa B" of
    // Mecatronică is drawn over the first column of Științe inginerești aplicate, whose
    // "Grupa 2" starts a column late; "sgr. 1" below starts at the programme's edge. The odd
    // weeks of Grupa 2 sgr. 1 became a group "Grupa B sgr. 1" that does not exist, and the
    // real group was left with lectures in even weeks only.
    const cells: Box[] = [
      [156.64, 57.72, 277.24, 59.69, "MECATRONICĂ ȘI ROBOTICĂ"], [277.24, 57.72, 358.38, 59.69, "ȘTIINȚE INGINEREȘTI APLICATE"],
      [156.64, 59.69, 236.33, 61.5, "Grupa A"], [236.33, 59.69, 296.46, 61.5, "Grupa B"], [296.46, 59.69, 358.38, 61.5, "Grupa 2"],
      [156.64, 61.5, 236.33, 63.3, "sgr. 1"], [236.33, 61.5, 277.24, 63.3, "sgr. 1"], [277.24, 61.5, 315.78, 63.3, "sgr. 1"], [315.78, 61.5, 358.38, 63.3, "sgr. 2"],
      [236.33, 63.3, 255.66, 65.09, "săpt. impară"], [255.66, 63.3, 277.24, 65.09, "săpt. pară"],
      [277.24, 63.3, 296.46, 65.09, "săpt. impară"], [296.46, 63.3, 315.78, 65.09, "săpt. pară"],
      [315.78, 63.3, 336.78, 65.09, "săpt. impară"], [336.78, 63.3, 358.38, 65.09, "săpt. pară"],
      [140, 65.09, 156.64, 70, "08:00 - 10:00"], [140, 70, 156.64, 75, "10:00 - 12:00"], [140, 75, 156.64, 80, "12:00 - 14:00"],
      [156.64, 65.09, 358.38, 70, "TERMOTEHNICĂ I (C) N 210"],
      [277.24, 70, 296.46, 75, "M (L) Orologerie"], [296.46, 70, 315.78, 75, "TT (L) M101"],
    ];
    const table = readPrintedTable(cells, "Anul II", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: labels[0], degree: "bachelor" }, year: 2, series: "", name: labels.slice(1).filter((l) => !/^săpt/.test(l)).join(" "),
    })));
    const group = (i: number) => `${table.groups[i].spec.name.split(" ")[0]} ${table.groups[i].name}`;
    expect(table.groups.map((_, i) => group(i))).toEqual(["MECATRONICĂ Grupa A sgr. 1", "MECATRONICĂ Grupa B sgr. 1", "ȘTIINȚE Grupa 2 sgr. 1", "ȘTIINȚE Grupa 2 sgr. 2"]);
    expect(table.entries.map((e) => [e.courseName, e.weeks, e.groups.map(group).join(", ")])).toEqual([
      ["TERMOTEHNICĂ I", "all", "MECATRONICĂ Grupa A sgr. 1, MECATRONICĂ Grupa B sgr. 1, ȘTIINȚE Grupa 2 sgr. 1, ȘTIINȚE Grupa 2 sgr. 2"],
      ["M", "odd", "ȘTIINȚE Grupa 2 sgr. 1"], ["TT", "even", "ȘTIINȚE Grupa 2 sgr. 1"],
    ]);
  });

  it("puts a class back together when its teacher or room comes in a box of its own", () => {
    // Mecanică, year 2 (coordinates as read from the published PDF). "MN (L) Cristian Pop
    // Orologerie 408 (etaj IV)" is one blue cell over the odd and the even column; it is
    // printed whole for one group, cut between the columns for another and cut between two
    // hours for a third. The room was shown as a class of its own, in even weeks.
    const cells: Box[] = [
      [76.93, 61.5, 116.83, 63.3, "sgr. 1"], [116.83, 61.5, 156.64, 63.3, "sgr. 2"], [156.64, 61.5, 196.49, 63.3, "sgr. 3"],
      [76.93, 63.3, 96.3, 65.09, "săpt. impară"], [96.3, 63.3, 116.83, 65.09, "săpt. pară"],
      [116.83, 63.3, 136.14, 65.09, "săpt. impară"], [136.14, 63.3, 156.64, 65.09, "săpt. pară"],
      [156.64, 63.3, 175.98, 65.09, "săpt. impară"], [175.98, 63.3, 196.49, 65.09, "săpt. pară"],
      [64.38, 101.09, 76.93, 102.9, "16:00 - 17:00"], [64.38, 102.9, 76.93, 104.71, "17:00 - 18:00"],
      [64.38, 104.71, 76.93, 106.5, "18:00 - 19:00"], [64.38, 106.5, 76.93, 108.29, "19:00 - 20:00"],
      [76.93, 101.09, 116.83, 104.71, "MN (L)\nCristian Pop Orologerie 408 (etaj IV)"],
      [116.83, 104.71, 156.64, 106.5, "MN (L)"], [116.83, 106.5, 156.64, 108.29, "Cristian Pop Orologerie 408 (etaj IV)"],
      [156.64, 104.71, 175.98, 108.29, "MN (L)\nCristian Pop"], [175.98, 104.71, 196.49, 108.29, "Orologerie 408 (etaj IV)"],
      // A lecturer alone under the lab, a stray mark, and a lab whose bracket fell into the next cell.
      [76.93, 104.71, 96.3, 106.5, "DA (L) Lab AR"], [76.93, 106.5, 96.3, 108.29, "D Ostoia"],
      [96.3, 104.71, 116.83, 106.5, "`"], [96.3, 106.5, 116.83, 108.29, "Fizica (L"],
    ];
    const table = readPrintedTable(cells, "Anul II", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: "Inginerie mecanică", degree: "bachelor" }, year: 2, series: "", name: labels[0],
    })));
    const seen = table.entries.map((e) => `${table.groups[e.groups[0]].name} ${e.startMin / 60}-${e.endMin / 60} ${e.weeks} ${e.kind} ${e.courseName} @${e.room ?? "-"} ${e.teacher ?? "-"}`).sort();
    expect(seen).toEqual([
      "sgr. 1 16-18 all lab MN @Orologerie 408 Cristian Pop",
      "sgr. 1 18-20 odd lab DA @- Lab AR D Ostoia",
      "sgr. 1 19-20 even lab Fizica @- -",
      "sgr. 2 18-20 all lab MN @Orologerie 408 Cristian Pop",
      "sgr. 3 18-20 all lab MN @Orologerie 408 Cristian Pop",
    ]);
  });

  it("reads \"S1-S7\" over a column as the weeks of the classes below it, and starts a stitched lab with its row", () => {
    // Mecanică, master Inginerie integrată: Monday splits into "S1-S7" and "S8-S14". Both were
    // shown as classes, and all four MIPT blocks appeared every week, overlapping.
    // Year 1: "GDDT (L) Farkas A." is written half-way down 18-20, its room in 20-21.
    const cells: Box[] = [
      [156.02, 180, 304.91, 190, "Anul II"],
      [140, 199.22, 156.02, 212.42, "14-16"], [140, 212.42, 156.02, 238.7, "16-18"], [140, 238.7, 156.02, 264.98, "18-20"], [140, 264.98, 156.02, 278.12, "20-21"],
      [156.02, 199.22, 219.77, 212.42, "S1-S7"], [219.77, 199.22, 304.91, 212.42, "S8-S14"],
      [156.02, 212.42, 219.77, 238.7, "MIPT (C)\nSala M 010"], [219.77, 212.42, 304.91, 238.7, "MIPT (P)\nSala 126 SPM"],
      [156.02, 251.84, 219.77, 264.98, "GDDT (L) Farkas A."], [156.02, 264.98, 219.77, 278.12, "Sala N 302"],
      [219.77, 238.7, 304.91, 264.98, "GDDT (L) Farkas A.\nSala N 302"],
    ];
    const read = (splitSharedHours: boolean) => readPrintedTable(cells, "Anul II", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: "Inginerie integrată", degree: "master" }, year: 2, series: "", name: labels[0],
    })), "all", undefined, { splitSharedHours }).entries.map((e) => `${e.startMin / 60}-${e.endMin / 60} ${e.weeks} ${e.kind} ${e.courseName} @${e.room}`).sort();
    expect(read(true)).toEqual([
      "16-18 1-7 course MIPT @M 010", "16-18 8-14 project MIPT @126 SPM",
      "18-20 8-14 lab GDDT @N 302", "18-21 1-7 lab GDDT @N 302",
    ]);
    // Where rows are drawn to scale (Construcții), the same boxes are a class from 19 to 21.
    expect(read(false)).toContain("19-21 1-7 lab GDDT @N 302");
  });

  it("reads both activities of an IEE cell that names two taking turns", () => {
    // Inginerie electrică, years 3 and 4. Only the first was kept: the odd-week MNCE project
    // did not exist, "M.E Seminar · A214" showed every week although odd weeks are a BAE
    // project in A215, and the IEJT project never became the lab it is from week 7.
    const read = (cell: string) => electricalActivities(cell).map(electricalCell).map((a) => `${a.name} ${a.kind} ${a.weeks} @${a.room}`);
    expect(read("MNCE lab. S.P, C423/ MNCE\npr.S.I c423")).toEqual(["MNCE lab even @C423", "MNCE project odd @C423"]);
    expect(read("M.E, sem, SP, A214 / BAE pr. SI A215")).toEqual(["M.E seminar even @A214", "BAE project odd @A215"]);
    expect(read("SP: IA, lab /\nSI: IA pr D010")).toEqual(["IA lab even @D010", "IA project odd @D010"]);
    expect(read("C 220, IEJT (P) s. 2-6\nC 220, IEJT (L) s. 7-11")).toEqual(["IEJT project 2-6 @C 220", "IEJT lab 7-11 @C 220"]);
    expect(read("C 002 Limba Franceză (S) / A 216 Limba Engleză (S)")).toEqual(["Limba Franceză seminar all @C 002", "Limba Engleză seminar all @A 216"]);
    // A subgroup or two rooms written with a slash are not two activities, and neither are the lines of a note.
    expect(read("sg. 3/2, C303B, Fiz. (L) s.imp")).toHaveLength(1);
    expect(read("TCE, lab, SP, C304/C305")).toEqual(["TCE lab even @C304"]);
    expect(read("A223, Etică şi Integritate Academică (S)\ns. 1,3,5 grupa 1\ns. 2,4,6 grupa 2")).toHaveLength(1);
  });

  it("lets the length a timetable states for a class win over the box it is drawn in", () => {
    // IEE, year 3: "Controlere Logice Programabile (s:1-8 2h, s:9-12 3h)" is drawn in the 12-14
    // row. In weeks 9 to 12 the calendar and the assistant said it ends at 14:00.
    const cells: Box[] = [
      [1, 0, 2, 1, "Grupa 1"], [0, 1, 1, 2, "12-14"], [0, 2, 1, 3, "14-16"], [0, 3, 1, 4, "16-18"],
      [1, 1, 2, 2, "Controlere Logice Programabile (s:1-8 2h, s:9-12 3h), curs, Sala D104"],
    ];
    const table = readPrintedTable(cells, "Anul III", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: "Electrotehnică", degree: "bachelor" }, year: 3, series: "", name: labels[0],
    })));
    expect(table.entries.map((e) => [e.weeks, e.startMin / 60, e.endMin / 60])).toEqual([["1-8", 12, 14], ["9-12", 12, 15]]);
  });

  it("reads the weeks a Construcții class is limited to when they stand between its room and its lecturer", () => {
    // Master OSH: shown every week, with "(săpt. 5-11) Conf.dr.ing Ș.V. NICOARĂ" as the lecturer.
    expect(civilCell("Teoria elasticitaţii şi calculul plastic al structurilor\nNM (săpt. 5-11) Conf.dr.ing Ș.V. NICOARĂ"))
      .toMatchObject({ room: "NM", weeks: "5-11", teacher: "Conf.dr.ing Ș.V. NICOARĂ" });
    // The caption of the room box is not part of the name, whatever case the title is in.
    expect(civilCell("Sală M.e.f. - elemente avansate Mărginean\nA311")).toMatchObject({ name: "M.e.f. - elemente avansate Mărginean", room: "A311" });
  });

  it("gives a Mecanică class written in half of its row the whole row", () => {
    // Mecanică, year 1, Tuesday 14-16: "Chimie (L)" is a cell split by a diagonal, and its text
    // box covers the lower half of the row only (coordinates as read from the published PDF).
    // Read as "the second hour", the student arrived at 15:00 for a lab that starts at 14:00.
    const cells: Box[] = [
      [86.52, 84, 178.46, 90, "semigrupa 1"], [178.46, 84, 272.79, 90, "semigrupa 2"],
      [68.4, 185.04, 86.52, 194.64, "12_14"], [68.4, 194.64, 86.52, 207.86, "14_16"], [68.4, 207.86, 86.52, 226.21, "16_18"],
      [178.46, 201.42, 272.79, 207.86, "Chimie (L)"],
    ];
    const read = (splitSharedHours: boolean) => readPrintedTable(cells, "Anul I", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: "Bioinginerie", degree: "bachelor" }, year: 1, series: "", name: labels[0],
    })), "all", undefined, { splitSharedHours }).entries.map((e) => [e.courseName, e.startMin / 60, e.endMin / 60]);
    expect(read(true)).toEqual([["Chimie", 14, 16]]);
    // Only there: rows drawn to scale keep the hour the box shows.
    expect(read(false)).toEqual([["Chimie", 15, 16]]);
  });

  it("reads a Construcții lecture with its hall and lecturer on a second line as one class", () => {
    // English line, year 1: "LINEAR ALGEBRA A.GEOM." with "MP Arieșanu" below it was shown as
    // two classes side by side, the second called "MP Arieșanu" and given the room of the
    // year-2 column next to it. Cadastru: "ANALIZĂ" and "LN (Ca2) (CA2) S.l.dr.Hedrea".
    const cells: Box[] = [
      [1, 0, 2, 1, "a"], [2, 0, 3, 1, "b"],
      [0, 1, 1, 3, "12-14"], [0, 3, 1, 5, "14-16"], [0, 5, 1, 7, "16-18"],
      [1, 1, 2, 2, "LINEAR ALGEBRA A.GEOM."], [1, 2, 2, 3, "MP Arieșanu"],
      [2, 1, 3, 2, "COMP. AIDED GRAPHICS"], [2, 2, 3, 3, "A109"],
      [1, 3, 2, 4, "ANALIZĂ"], [1, 4, 2, 5, "LN (Ca2) (CA2) S.l.dr.Hedrea"],
      [2, 3, 3, 4, "TUTORIERE A111"],
    ];
    const table = readPrintedTable(cells, "Anul I", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: "Inginerie civilă", degree: "bachelor" }, year: 1, series: "", name: labels[0],
    })), "all", civilCell, { isDetail: civilDetail });
    expect(table.entries.map((e) => `${table.groups[e.groups[0]].name} ${e.startMin / 60}-${e.endMin / 60} ${e.courseName} @${e.room} ${e.teacher ?? "-"}`).sort()).toEqual([
      "a 12-14 LINEAR ALGEBRA A.GEOM. @MP Arieșanu",
      "a 14-16 ANALIZĂ @LN (Ca2) S.l.dr.Hedrea",
      "b 12-14 COMP. AIDED GRAPHICS @A109 -",
      // Alone in the upper half of its row: one hour, as printed.
      "b 14-15 TUTORIERE @A111 -",
    ]);
    // The hall written after the lecturer, or between the title and the lecturer, is the room.
    expect(civilCell("Sală GEOLOGIE INGINEREASCA Ciopec NM")).toMatchObject({ name: "GEOLOGIE INGINEREASCA", room: "NM", teacher: "Ciopec" });
    expect(civilCell("AMENAJĂRI HIDROTEHNICE H1 Conf\n.dr.ing NICOARA SV")).toMatchObject({ name: "AMENAJĂRI HIDROTEHNICE", room: "H1" });
  });

  it("gives a series lecture to every group, with the room boxed at the end of its row", () => {
    // Construcții, year 1: the lecture spans groups a to c and its room ("VV") is boxed in
    // the last group's column, below that group's own seminar and its room.
    const cells: Box[] = [
      [1, 0, 2, 1, "111 a"], [2, 0, 3, 1, "111 b"], [3, 0, 4, 1, "112 a"], [4, 0, 5, 1, "112 b"],
      [0, 1, 1, 2, "8-10"], [0, 2, 1, 3, "10-12"], [0, 3, 1, 4, "12-14"],
      [4, 1, 5, 1.6, "Calc."], [4, 1.6, 5, 2, "A107"],
      [1, 2, 4, 3, "GEOMETRIE DESCRIPTIVĂ C.Voicu\nSală"], [4, 2, 5, 3, "VV"],
      [1, 3, 4, 4, "CHIMIE GENERALĂ Vancea\nSală"], [4, 3, 5, 4, "NM"],
    ];
    const table = readPrintedTable(cells, "Anul I", (headers) => headerColumns(headers, (labels) => ({
      spec: { name: "Inginerie civilă", degree: "bachelor" }, year: 1, series: "", name: labels[0],
    })), "all", civilCell, { isDetail: civilDetail });
    const of = (name: RegExp) => table.entries.filter((e) => name.test(e.courseName));
    expect(of(/GEOMETRIE/)).toEqual([expect.objectContaining({ courseName: "GEOMETRIE DESCRIPTIVĂ", teacher: "C.Voicu", startMin: hm(10), endMin: hm(12), room: "VV", groups: [0, 1, 2, 3] })]);
    expect(of(/CHIMIE/)).toEqual([expect.objectContaining({ startMin: hm(12), endMin: hm(14), room: "NM", groups: [0, 1, 2, 3] })]);
    // The last group's own seminar keeps its two hours and its room.
    expect(of(/^Calc/)).toEqual([expect.objectContaining({ startMin: hm(8), endMin: hm(10), room: "A107", groups: [3] })]);
  });

  it("splits a seminar and a lab that share a cell at Robotics, each in its weeks and for its semigroup", () => {
    // RIA, year 1, Tuesday 10-12, the cell merged across semigroups 1/1 and 1/2.
    const cell = "Fizica (S) sapt. impare Sala N206 Fizica (L) sapt. pare (gr 1.1) Sala C303a";
    expect(roboticsActivities(cell)).toEqual(["Fizica (S) sapt. impare Sala N206", "Fizica (L) sapt. pare (gr 1.1) Sala C303a"]);
    expect(roboticsActivities("Fizica (S) sapt. impare Sala N206 Fizica (L) par (gr 2.1) Sala C303a")).toHaveLength(2);
    expect(roboticsActivities("Chimie (C) sala M306 Prof.dr Ing. Narcis DUȚEANU")).toHaveLength(1);
    const cells: Box[] = [
      [1, 0, 3, 1, "Grupa 1"], [1, 1, 2, 2, "1/1"], [2, 1, 3, 2, "1/2"],
      [0, 2, 1, 3, "8-10"], [0, 3, 1, 4, "10-12"], [0, 4, 1, 5, "12-14"],
      [1, 3, 3, 4, cell],
    ];
    const table = readPrintedTable(cells, "An I", (headers) => headerColumns(headers.filter((b) => /^(?:grupa|\d)/i.test(b[4])), (path) => ({
      spec: { name: "Mecatronică și robotică", degree: "bachelor" }, year: 1, series: "", name: path.join(" "),
    })), "all", undefined, { splitActivities: roboticsActivities, isFor: roboticsAudience });
    expect(table.groups.map((g) => g.name)).toEqual(["Grupa 1 1/1", "Grupa 1 1/2"]);
    expect(table.entries).toEqual([
      expect.objectContaining({ courseName: "Fizica", kind: "seminar", weeks: "odd", room: "N206", groups: [0, 1], startMin: hm(10), endMin: hm(12) }),
      // The lab the students were told did not exist: even weeks, semigroup 1/1 only.
      expect.objectContaining({ courseName: "Fizica", kind: "lab", weeks: "even", room: "C303a", groups: [0] }),
    ]);
  });

  it("reads the printed term, room and lecturer without treating evening hours as an academic year", () => {
    expect(pageTerm("20-21\nSemestrul I 2026/2027")).toEqual({ academicYear: "2026-2027", semester: 1 });
    expect(pageTerm("ORAR\nSemestrul II\nAnul III Anul universitar 2026/2027")).toEqual({ academicYear: "2026-2027", semester: 2 });
    expect(pageTerm("MASTER ANUL II, Sem. I 2025-2026").academicYear).toBe("2025-2026");
    expect(civilCell("Fundaţii\nLG 6 Roman O.")).toMatchObject({ name: "Fundaţii", room: "LG 6", teacher: "Roman O." });
    expect(electricalCell("A 101, Circuite, Conf.dr. I. Pop (C) săpt. 2-13")).toMatchObject({
      name: "Circuite", kind: "course", room: "A 101", teacher: "Conf.dr. I. Pop", weeks: "2-13",
    });
    expect(parseCellText("Materiale (curs) ‐ primele 10 săptămâni").weeks).toBe("1-10");
    expect(parseCellText("Fizica (L) par (gr 2.1) Sala C303a")).toMatchObject({ kind: "lab", weeks: "even", room: "C303a" });
    // IEE years 2-4: SP and SI are even and odd weeks, never a lecturer.
    expect(electricalCell("TCE, lab, SP, C304")).toMatchObject({ name: "TCE", kind: "lab", room: "C304", weeks: "even", teacher: null });
    expect(electricalCell("CS2, lab, D010 S.I.")).toMatchObject({ kind: "lab", room: "D010", weeks: "odd", teacher: null });
    expect(electricalCell("CS2, pr, SP, s8-14 D010")).toMatchObject({ kind: "project", weeks: "8-14&even", room: "D010" });
    expect(electricalCell("SIAA, lab, S.I C423")).toMatchObject({ kind: "lab", weeks: "odd", room: "C423" });
    expect(electricalCell("GAC (L) s:1- 9 SPM Et. II sala 218")).toMatchObject({ name: "GAC", kind: "lab", weeks: "1-9", room: "218 SPM", teacher: null });
    expect(electricalCell("Facultatea de Chimie, sala A2, Curs de pregătire la Fizică, Prof.dr.fiz. Nicolina POP")).toMatchObject({
      name: "Curs de pregătire la Fizică", room: "A2 Chimie", teacher: "Prof.dr.fiz. Nicolina POP",
    });
  });

  it("inherits the day and half-hour range for FIH rows while keeping subgroup and week restrictions", () => {
    const html = `<select id="sem"><option selected>2026-2027 sem. 1</option></select><h3>Grupa: L4 IVD</h3>
      <table class="orar"><tr><td class="wkd">Marți</td><td class="ore">12-14<sup>30</sup></td>
      <td class="disc">Chimie</td><td class="cslp">C</td></tr>
      <tr><td class="disc">Analiză</td><td class="sg">1</td><td class="weeks">I 1-9</td></tr>
      <tr><td class="disc">Reciclare</td><td class="sg">2</td></tr></table>`;
    const table = fihAdapter.parseHtml!(html, { label: "L4 IVD", academicYear: "2026-2027", semester: 1 } as DiscoveredSource);
    expect(table.groups.map((g) => g.name)).toEqual(["1", "2"]);
    expect(table.entries[0]).toMatchObject({ groups: [0, 1], weeks: "all", endMin: hm(14, 30) });
    expect(table.entries[1]).toMatchObject({ groups: [0], day: 2, startMin: hm(12), endMin: hm(14, 30), weeks: "odd&1-9" });
  });
});

describe("exam grids", () => {
  it("parses booking cells", () => {
    expect(parseExamCell("C-ro+TI 3\nAVD  C. Cernăzanu")).toMatchObject({ audience: "C-ro+TI", year: 3, courseAbbr: "AVD", teacher: "C. Cernăzanu" });
    expect(parseExamCell("AIA  1\nET Anul 1 Seria A I. Tatai")).toMatchObject({ audience: "AIA", year: 1, courseAbbr: "ET", detail: "Anul 1 Seria A", teacher: "I. Tatai" });
    // Faculty allocation markers and room reservations are not exams.
    expect(parseExamCell("ETcTI")).toBeNull();
    expect(parseExamCell("15.06-rez.Sed.Dep.CTI")).toBeNull();
    expect(parseExamCell("rez Proiect ACCES_UPT Loredana STANCIU")).toBeNull();
  });

  it("parses a real AC session workbook and merges consecutive slots", async () => {
    const grids = await loadWorkbook(fixture("ac-exams-summer-2026.xlsx"));
    const exams = grids.flatMap((g) => parseRoomGridExams(g));
    expect(exams.length).toBeGreaterThan(60);
    const dem = exams.find((e) => e.courseAbbr === "DEM" && e.date === "2026-06-15")!;
    // Booked 10–12 and 12–14 in the same room: one four-hour exam.
    expect(dem).toMatchObject({ room: "ASPC", startMin: hm(10), endMin: hm(14), audience: "C-ro+TI", year: 1, teacher: "R. Ionel" });

    const normalized = acAdapter.parseExams!(grids, {} as DiscoveredSource);
    const one = normalized.find((e) => e.courseAbbr === "DEM")!;
    expect(one.specs.map((s) => s.code).sort()).toEqual(["C", "CTI", "TI"]);
    expect(normalized.find((e) => e.audience.startsWith("M-CCIT"))!.specs[0]).toMatchObject({ code: "CCIT", degree: "master" });
  });
});

describe("discovery", () => {
  it("detects academic year and semester in headings and file names", () => {
    expect(detectAcademicYear("Semestrul I. Orar licență și masterat an universitar 2026-2027")).toBe("2026-2027");
    expect(detectAcademicYear("orar 3 ISEE ETI 26-27 sem1_7.pdf")).toBe("2026-2027");
    expect(detectAcademicYear("ANUL III - SEM. I 2026/2027")).toBe("2026-2027");
    expect(detectAcademicYear("Luni 10-12")).toBeNull();
    expect(detectSemester("Semestrul II. Orare licență")).toBe(2);
    expect(detectSemester("1. ANI ING CIVILA ORARE SEM 1 2026-2027")).toBe(1);
    expect(detectSemester("Orar an universitar 2026-2027, semestrul I")).toBe(1);
    expect(detectSemester("Orar")).toBeNull();
  });

  it("pairs links with the heading above them and keeps only the target semester", () => {
    const html = `<body><main>
      <p>Semestrul I. Orar licență și masterat an universitar 2026-2027</p>
      <ul><li><a href="https://x.sharepoint.com/:x:/g/personal/a/ABC?e=1">C-RO • TI-RO</a></li>
          <li><a href="/wp/Orar_consult.xls">Orar consultații AIA</a></li></ul>
      <p>Semestrul II. Orare licență și master an universitar 2024-2025</p>
      <a href="https://docs.google.com/spreadsheets/d/e/2PACX-old/pubhtml">CTI • CTI Engleză</a>
    </main></body>`;
    const sources = extractLinks(html, "https://ac.upt.ro/orare/")
      .map((l) => classifyLink(l, "timetable"))
      .filter((s): s is DiscoveredSource => !!s);
    expect(sources.map((s) => [s.label, s.format, s.academicYear, s.semester])).toEqual([
      ["C-RO • TI-RO", "xlsx", "2026-2027", 1],
      ["CTI • CTI Engleză", "gsheet", "2024-2025", 2],
    ]);
    const target = { academicYear: "2026-2027", number: 1 };
    expect(sources.filter((s) => matchesSemester(s, target)).map((s) => s.label)).toEqual(["C-RO • TI-RO"]);
  });

  it("rewrites share links into direct downloads", () => {
    expect(downloadUrl({ url: "https://x.sharepoint.com/:x:/g/personal/a/ABC?e=1", format: "xlsx" })).toBe(
      "https://x.sharepoint.com/:x:/g/personal/a/ABC?e=1&download=1",
    );
    expect(downloadUrl({ url: "https://mpt.upt.ro/orar.xlsx", format: "xlsx" })).toBe("https://mpt.upt.ro/orar.xlsx");
  });
});

describe("catalog", () => {
  it("splits programme labels from upt.ro", () => {
    expect(parseProgrammeLabel("Calculatoare și tehnologia informației, 4 ani, EN")).toEqual({
      name: "Calculatoare și tehnologia informației",
      durationYears: 4,
      language: "EN",
    });
    expect(parseProgrammeLabel("Automatică, informatică aplicată și sisteme inteligente, 4 ani, RO")).toMatchObject({
      name: "Automatică, informatică aplicată și sisteme inteligente",
    });
    expect(parseProgrammeLabel("Științe ale comunicării, 3 ani, RO, ID")).toMatchObject({ durationYears: 3, language: "RO, ID" });
  });

  it("reads the specialization cards of a domain page", () => {
    const html = `<main><div><div><div><h2>Specializare</h2></div><div><p>… vei absolvi cu una dintre aceste specializări: </p>
      <div><div><div><div></div><div>Calculatoare</div></div></div><div><div><div></div><div>Tehnologia informației</div></div></div></div></div></div></div></main>`;
    expect(extractSpecializations(html)).toEqual(["Calculatoare", "Tehnologia informației"]);
    expect(extractSpecializations("<main><h2>Admitere</h2></main>")).toEqual([]);
  });
});
