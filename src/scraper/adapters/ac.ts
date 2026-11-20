import { parseRoomGridExams } from "../exams";
import { norm, squash } from "../text";
import type { FacultyAdapter, NormalizedExam, SpecRef } from "../types";
import { genericNormalize } from "./generic";

/**
 * Facultatea de Automatică și Calculatoare.
 *
 * Timetables are two Excel workbooks shared from SharePoint, one sheet per year and
 * programme. Exams live in a room-booking workbook per session.
 */

const CTI: SpecRef = { name: "Calculatoare și tehnologia informației", code: "CTI", degree: "bachelor", language: "RO" };
const CTI_EN: SpecRef = { name: "Calculatoare și tehnologia informației", code: "CTI-EN", degree: "bachelor", language: "EN" };
const C: SpecRef = { name: "Calculatoare", code: "C", degree: "bachelor", language: "RO" };
const TI: SpecRef = { name: "Tehnologia informației", code: "TI", degree: "bachelor", language: "RO" };
const AIASI: SpecRef = { name: "Automatică, informatică aplicată și sisteme inteligente", code: "AIASI", degree: "bachelor", language: "RO" };
const AIA: SpecRef = { name: "Automatică și informatică aplicată", code: "AIA", degree: "bachelor", language: "RO" };

const MASTERS: Record<string, string> = {
  CCIT: "Cloud Computing and Internet of Things",
  DW: "Digital Media and Web Development",
  ML: "Machine Learning",
  QC: "Quantum Computing",
  SE: "Software Engineering",
  AES: "Automotive Embedded Software",
  GD: "Game Development",
  ISA: "Ingineria sistemelor automate",
  SIAPS: "Sisteme informatice aplicate în producție și servicii",
  SISC: "Securitatea informațiilor și a sistemelor cibernetice",
  SIIS: "Sisteme informatice în îngrijirea sănătății",
};

function master(code: string): SpecRef {
  const key = code.toUpperCase();
  return { name: MASTERS[key] ?? code, code: key, degree: "master" };
}

/** Audience codes used in exam bookings → the specializations that sit the exam. */
function audienceSpecs(audience: string): SpecRef[] {
  const specs: SpecRef[] = [];
  for (const raw of audience.split("+")) {
    const token = norm(raw).replace(/ /g, "");
    if (token === "cro" || token === "c") specs.push(C, CTI);
    else if (token === "ti") specs.push(TI, CTI);
    else if (token === "ceng" || token === "cen") specs.push(CTI_EN);
    else if (token === "aia" || token === "aiasi") specs.push(AIA, AIASI);
    else if (token.startsWith("m") && raw.includes("-")) specs.push(master(raw.split("-").slice(1).join("-").trim()));
  }
  return [...new Set(specs)];
}

export const acAdapter: FacultyAdapter = {
  slug: "facultatea-de-automatica-si-calculatoare",

  examPages: () => ["https://ac.upt.ro/examene/"],

  classify(link, guess, semester, page) {
    if (page === "exams") {
      // Session workbooks carry no year; the page always shows the current year's.
      if (guess.format !== "xlsx") return null;
      const winter = /iarn/i.test(link.label);
      const summer = /var[aă]|toamn/i.test(link.label);
      if (!winter && !summer) return null;
      if ((semester.number === 1) !== winter) return null;
      return { ...guess, kind: "exams", academicYear: semester.academicYear, semester: semester.number };
    }
    if (guess.format !== "xlsx" && guess.format !== "gsheet") return null;
    // The page keeps years of archives, some under headings without a year; only
    // trust documents explicitly listed under the target academic year.
    if (guess.academicYear !== semester.academicYear) return null;
    return guess;
  },

  normalize(parsed, source) {
    const sheet = squash(parsed.sheet);
    let m: RegExpExecArray | null;

    if ((m = /^An (\d)$/i.exec(sheet))) {
      return genericNormalize(parsed, source, {
        degree: "bachelor",
        year: +m[1],
        spec: (track) => {
          const t = norm(track ?? "");
          if (t.startsWith("calculatoare")) return C;
          if (t.startsWith("tehnologia")) return TI;
          return CTI;
        },
        series: (track) => (track && /^seria/i.test(track) ? squash(track) : ""),
      });
    }
    if ((m = /^An (\d) Eng$/i.exec(sheet))) {
      return genericNormalize(parsed, source, { degree: "bachelor", year: +m[1], spec: () => CTI_EN, series: () => "" });
    }
    if ((m = /^AIA(SI)?-an (I{1,3}|IV)$/i.exec(sheet))) {
      return genericNormalize(parsed, source, { degree: "bachelor", spec: () => (m![1] ? AIASI : AIA), series: () => "" });
    }
    if ((m = /^An (\d) ([A-Z]{2,6})$/.exec(sheet))) {
      const spec = master(m[2]);
      return genericNormalize(parsed, source, { degree: "master", year: +m[1], spec: () => spec, series: () => "" });
    }
    if ((m = /^Master An (I{1,2})$/i.exec(sheet))) {
      return genericNormalize(parsed, source, {
        degree: "master",
        year: m[1].length,
        spec: (track) => master(squash(track ?? "")),
        series: () => "",
      });
    }
    return null;
  },

  parseExams(grids) {
    const exams: NormalizedExam[] = [];
    for (const grid of grids) {
      for (const e of parseRoomGridExams(grid)) {
        exams.push({
          date: e.date,
          startMin: e.startMin,
          endMin: e.endMin,
          room: e.room,
          courseName: e.courseAbbr,
          courseAbbr: e.courseAbbr,
          teacher: e.teacher,
          audience: `${e.audience} ${e.year ?? ""}${e.detail ? ` · ${e.detail}` : ""}`.trim(),
          year: e.year,
          specs: audienceSpecs(e.audience),
          rawText: e.rawText,
        });
      }
    }
    return exams;
  },
};
