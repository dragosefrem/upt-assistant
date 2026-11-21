import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { acAdapter } from "@/scraper/adapters/ac";
import { fihAdapter } from "@/scraper/adapters/fih";
import { etcAdapter } from "@/scraper/adapters/others";
import { pageTerm } from "@/scraper/adapters/printedFaculties";
import { civilCell, electricalCell, headerColumns, readPrintedTable, type Box } from "@/scraper/printed";
import { extractSpecializations, parseProgrammeLabel } from "@/scraper/catalog";
import { parseCellText } from "@/scraper/cellText";
import { classifyLink, detectAcademicYear, detectSemester, downloadUrl, extractLinks, matchesSemester } from "@/scraper/discover";
import { parseExamCell, parseRoomGridExams } from "@/scraper/exams";
import { Grid, loadHtmlTables, loadWorkbook } from "@/scraper/grid";
import { acronym, parseStudyYear, parseTimeRange } from "@/scraper/text";
import { parseSlotNote, parseTimetable } from "@/scraper/timetable";
import type { DiscoveredSource } from "@/scraper/types";

/** Real documents downloaded from UPT faculty sites in November 2026. */
const fixture = (name: string) => fs.readFileSync(path.join(__dirname, "fixtures", name));

const hm = (h: number, m = 0) => h * 60 + m;

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

  it("reads the printed term, room and lecturer without treating evening hours as an academic year", () => {
    expect(pageTerm("20-21\nSemestrul I 2026/2027")).toEqual({ academicYear: "2026-2027", semester: 1 });
    expect(pageTerm("ORAR\nSemestrul II\nAnul III Anul universitar 2026/2027")).toEqual({ academicYear: "2026-2027", semester: 2 });
    expect(pageTerm("MASTER ANUL II, Sem. I 2025-2026").academicYear).toBe("2025-2026");
    expect(civilCell("Fundaţii\nLG 6 Roman O.")).toMatchObject({ name: "Fundaţii", room: "LG 6", teacher: "Roman O." });
    expect(electricalCell("A 101, Circuite, Conf.dr. I. Pop (C) săpt. 2-13")).toMatchObject({
      name: "Circuite", kind: "course", room: "A 101", teacher: "Conf.dr. I. Pop", weeks: "2-13",
    });
    expect(parseCellText("Materiale (curs) ‐ primele 10 săptămâni").weeks).toBe("1-10");
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
