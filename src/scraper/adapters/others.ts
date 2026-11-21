import { norm, parseStudyYear, romanToInt, squash } from "../text";
import * as cheerio from "cheerio";
import { classifyLink, detectAcademicYear, detectSemester, extractLinks } from "../discover";
import type { FacultyAdapter, SpecRef } from "../types";
import { genericNormalize } from "./generic";
import { hasKindMarker, parseCellText } from "../cellText";
import { parseTimetable } from "../timetable";

/** Facultatea de Electronică, Telecomunicații și Tehnologii Informaționale. */
const ETC_DOMAIN: SpecRef = {
  name: "Inginerie electronică, telecomunicații și tehnologii informaționale",
  code: "ETcTI",
  degree: "bachelor",
  language: "RO/EN",
};
const ETC_MASTERS: Record<string, string> = {
  ESI: "Electronica sistemelor inteligente", AES: "Automotive Electronic Systems",
  EB: "Electronică biomedicală", IRT: "Ingineria rețelelor de telecomunicații",
  CN: "Communications Networks Engineering", TM: "Tehnologii multimedia", ID: "Ingineria datelor",
};

export const etcAdapter: FacultyAdapter = {
  slug: "facultatea-de-electronica-telecomunicatii-si-tehnologii-informationale",

  // The landing page only links to one sub-page per semester.
  timetablePages: (semester) => [`https://etc.upt.ro/avizier/orar/orar-semestrul-${semester.number}`],

  timetableSources(html, url) {
    const $ = cheerio.load(html);
    const heading = $("h1,h2,h3,h4").toArray().map((el) => squash($(el).text())).find((s) => /^orarul semestrului/i.test(s));
    if (!heading) return [];
    return extractLinks(html, url).flatMap((link) => {
      if (!/^an\s+(I{1,3}|IV)$/i.test(link.label) || !/^orar (master|licen)/i.test(link.context)) return [];
      const guess = classifyLink(link, "timetable");
      if (guess?.format !== "gsheet") return [];
      return [{ ...guess, label: `${/master/i.test(link.context) ? "Master" : "Licență"} ${link.label}`,
        academicYear: detectAcademicYear(heading), semester: detectSemester(heading) }];
    });
  },

  normalize(parsed, source, grid) {
    const year = parseStudyYear(source.label);
    const master = /master/i.test(source.label);
    if (grid) {
      // The widest heading spans the entire master's class. Programme and intake
      // size are on the line immediately above each subgroup (e.g. "2CN 15").
      const tracks = grid.cells.filter((c) => c.row === 1 && /ETcTI/i.test(c.text));
      parsed = { ...parsed, groups: parsed.groups.map((g) => ({
        ...g, name: g.name.replace(/ \(\d+\)$/, ""),
        track: master ? grid.at(2, g.col)?.text ?? null : tracks.filter((c) => c.col <= g.col).at(-1)?.text ?? null,
      })) };
    }
    return genericNormalize(parsed, source, {
      degree: master ? "master" : "bachelor",
      year,
      spec: (track) => {
        const t = squash(track ?? "");
        if (master) {
          const code = t.replace(/^\d\s*/, "").replace(/\s*\d+$/, "");
          return { name: ETC_MASTERS[code] ?? t, code, degree: "master" };
        }
        if (/\b(?:eng|pi)\b/i.test(t)) {
          return { name: "Tehnologii și sisteme de telecomunicații (engleză)", code: "TST-EN", degree: "bachelor", language: "RO/EN" };
        }
        if (/\bEA\b/i.test(t)) return { name: "Electronică aplicată", code: "EA", language: "RO/EN", degree: "bachelor" };
        if (/\bTST\b/i.test(t)) return { name: "Tehnologii și sisteme de telecomunicații", code: "TST", language: "RO/EN", degree: "bachelor" };
        return ETC_DOMAIN;
      },
      series: (track) => (master ? "" : (/seria\s+\S+/i.exec(track ?? "")?.[0] ?? "").replace(/^seria/i, "Seria")),
    });
  },
};

/** Facultatea de Management în Producție și Transporturi: one workbook per semester. */
export const mptAdapter: FacultyAdapter = {
  slug: "facultatea-de-management-in-productie-si-transporturi",

  classify(link, guess) {
    if (guess.format !== "xlsx" || !/orar semestrul/i.test(link.label)) return null;
    return { ...guess, kind: "timetable" };
  },

  parseGrid(grid, source) {
    const parsed = parseTimetable(grid, { splitActivities(text) {
      // e.g. "MCS, s. impară: curs, s. pară: seminar, M105, C. Albulescu".
      const match = /^(.*?),\s*(s\.\s*(?:im)?par[aăe]?)\s*:\s*(curs|seminar|lab|proiect),\s*(s\.\s*(?:im)?par[aăe]?)\s*:\s*(curs|seminar|lab|proiect)(,.*)$/is.exec(text);
      return match ? [match[1] + ", " + match[3] + match[6] + ", " + match[2],
        match[1] + ", " + match[5] + match[6] + ", " + match[4]] : [text];
    } });
    return this.normalize!(parsed, source, grid);
  },

  normalize(parsed, source) {
    const sheet = squash(parsed.sheet);
    if (/^IM an /i.test(sheet)) {
      const im: SpecRef = { name: "Inginerie și management", code: "IM", degree: "bachelor" };
      return genericNormalize(parsed, source, {
        degree: "bachelor",
        spec: (track) => {
          const industry = norm(track ?? "").split(" ")[0];
          const programmes: Record<string, string> = { constructii: "Inginerie și management în construcții",
            mecanica: "Inginerie economică industrială", electro: "Inginerie economică în domeniul electric, electronic și energetic",
            chimie: "Inginerie economică în industria chimică și de materiale" };
          return programmes[industry] ? { name: programmes[industry], degree: "bachelor", language: "RO" } : im;
        },
        // Years III–IV split by industry ("Construcții", "Mecanică", …).
        series: (track) => {
          const t = squash((track ?? "").replace(/\s*-\s*[\d+ ]+$/, ""));
          return /inginerie/i.test(t) ? "" : t;
        },
      });
    }
    if (/^AP an /i.test(sheet)) {
      const ap: SpecRef = { name: "Administrație publică", code: "AP", degree: "bachelor" };
      const base = genericNormalize(parsed, source, { degree: "bachelor", year: 1, spec: () => ap, series: () => "" });
      if (!base) return null;
      // One column per study year instead of per group.
      const keep = new Map<number, number>();
      const groups = base.groups.flatMap((g, i) => {
        const year = parseStudyYear(g.name);
        if (!year) return [];
        keep.set(i, keep.size);
        return [{ ...g, year, name: "" }];
      });
      const entries = base.entries
        .map((e) => ({ ...e, groups: e.groups.filter((i) => keep.has(i)).map((i) => keep.get(i)!) }))
        .filter((e) => e.groups.length);
      return { groups, entries, warnings: base.warnings };
    }
    if (/^Master an (I{1,2})$/i.test(sheet)) {
      const base = genericNormalize(parsed, source, { degree: "master", spec: () => null, series: () => "" });
      if (!base) return null;
      // Columns are programmes (MAAA, IMC, …), not groups; "Master" is a legend column.
      const keep = new Map<number, number>();
      const groups = base.groups.flatMap((g, i) => {
        if (/^master$/i.test(g.name)) return [];
        keep.set(i, keep.size);
        const english = g.name.startsWith("IMCC");
        return [{ ...g, spec: { name: english ? "Quality and Competitiveness Engineering and Management" : g.name,
          code: g.name.split(/[ /(]/)[0], degree: "master" as const, language: english ? "EN" : "RO",
          previousSlugs: english ? ["imcc-qcem"] : undefined }, name: "" }];
      });
      const entries = base.entries
        .map((e) => ({ ...e, groups: e.groups.filter((i) => keep.has(i)).map((i) => keep.get(i)!) }))
        .filter((e) => e.groups.length);
      return { groups, entries, warnings: base.warnings };
    }
    return null;
  },
};

// A single FSC cell can print a different class, teacher, kind and audience each week.
// Keep ordinary slashes in names and rooms. A later half can omit a repeated subject.
function communicationActivities(text: string): string[] {
  const parts = text.split(/\s*\/+\s*|\s+(?=s[aă]pt\.?\s*(?:imp|par)[\p{L}.]*\s+[^/()]+\(\s*[cslp]\b)/iu);
  const activities: string[] = [];
  for (const part of parts.map(squash).filter(Boolean)) {
    const previous = activities.at(-1);
    if (!previous) { activities.push(part); continue; }
    const last = parseCellText(previous);
    if (last.hasKindMarker && hasKindMarker(part)) {
      // "Săpt. pară (s) C304" reuses the subject of the preceding lecture.
      const marker = /\(\s*(?:[cslp]|lab|seminar|curs|proiect)\b/i.exec(part);
      if (marker && /^s[aă]pt[.\s]*(?:imp|par)[\p{L}.]*\s*$/iu.test(part.slice(0, marker.index))) {
        activities.push(part.slice(0, marker.index) + last.name + " " + part.slice(marker.index));
      } else activities.push(part);
    } else if (last.hasKindMarker && /^s[aă]pt[.\s]*(?:imp|par)[\p{L}.]*\s+gr\.?\s*\d+\s+/iu.test(part)) {
      const qualifier = /^(.+?\bgr\.?\s*\d+\s+)(.+)$/iu.exec(part)!;
      activities.push(qualifier[1] + last.name + " (" + last.kind[0] + ") " + qualifier[2]);
    } else activities[activities.length - 1] = previous + "/" + part;
  }
  return activities;
}

/** Facultatea de Științe ale Comunicării: one small workbook per programme. */
export const fscAdapter: FacultyAdapter = {
  slug: "facultatea-de-stiinte-ale-comunicarii",

  classify(link, guess) {
    if (guess.format !== "xlsx" || !/orar/i.test(decodeURIComponent(link.url))) return null;
    return { ...guess, kind: "timetable" };
  },

  parseGrid(grid, source) {
    const parsed = parseTimetable(grid, { splitActivities: communicationActivities });
    const code = /ORAR_([A-Z]+)_/i.exec(decodeURIComponent(source.url))?.[1] ?? null;
    const master = code ? ["CRPMD", "CA", "CSASD", "TINT"].includes(code.toUpperCase()) : false;
    const spec: SpecRef = { name: code === "TI" ? "Traducere și interpretare (engleză și franceză/germană)" : squash(source.label),
      code, degree: master ? "master" : "bachelor", language: code === "TINT" ? "EN" : "RO",
      previousSlugs: code === "TI" ? ["traducere-si-interpretare-engleza-franceza-germana"] : undefined };
    // Sheets are named "CRP an I", "CA I" or "CAII": the year is the trailing numeral.
    const tail = /(III|II|I|IV)\s*$/.exec(squash(parsed.sheet))?.[1];
    const year = parsed.year ?? (tail ? romanToInt(tail) : null);
    // English is shared by both translation tracks. The second language is the group choice.
    const languages = parsed.groups.flatMap((g, i) => /^(franceza|germana)$/.test(norm(g.name)) ? [i] : []);
    const keep = parsed.groups.map((_, i) => i).filter((i) => !(languages.length === 2 && norm(parsed.groups[i].name) === "engleza"));
    const entries = parsed.entries.map((entry) => {
      const audience = new Set(entry.groups.flatMap((i) => keep.includes(i) ? [i] : languages));
      const qualifier = /(?:\bgr\.?\s*([FG12])|\bG([12]))\b/i.exec(entry.rawText);
      if (qualifier) {
        const token = (qualifier[1] ?? qualifier[2]).toUpperCase();
        const group = ["F", "1"].includes(token) ? /francez|^1\b/ : /german|^2\b/;
        const named = [...audience].filter((i) => group.test(norm(parsed.groups[i].name)));
        if (named.length) return { ...entry, groups: named.map((i) => keep.indexOf(i)) };
      }
      return { ...entry, groups: [...audience].map((i) => keep.indexOf(i)) };
    });
    return genericNormalize({ ...parsed, groups: keep.map((i) => parsed.groups[i]), entries }, source,
      { degree: spec.degree, year, spec: () => spec, series: () => "" });
  },
};
