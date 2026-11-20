import { parseStudyYear, romanToInt, squash } from "../text";
import type { FacultyAdapter, SpecRef } from "../types";
import { genericNormalize } from "./generic";

/** Facultatea de Electronică, Telecomunicații și Tehnologii Informaționale. */
const ETC_DOMAIN: SpecRef = {
  name: "Inginerie electronică, telecomunicații și tehnologii informaționale",
  code: "ETcTI",
  degree: "bachelor",
};

export const etcAdapter: FacultyAdapter = {
  slug: "facultatea-de-electronica-telecomunicatii-si-tehnologii-informationale",

  // The landing page only links to one sub-page per semester.
  timetablePages: (semester) => [`https://etc.upt.ro/avizier/orar/orar-semestrul-${semester.number}`],

  classify(link, guess, semester) {
    // Timetables are published Google Sheets labelled "an I" … "an IV".
    if (guess.format !== "gsheet" || !/^an\s+(I{1,3}|IV)$/i.test(link.label)) return null;
    const master = /master/i.test(link.context);
    return {
      ...guess,
      kind: "timetable",
      label: `${master ? "Master" : "Licență"} ${link.label}`,
      academicYear: semester.academicYear,
      semester: semester.number,
    };
  },

  normalize(parsed, source) {
    const year = parseStudyYear(source.label);
    const master = /master/i.test(source.label);
    return genericNormalize(parsed, source, {
      degree: master ? "master" : "bachelor",
      year,
      spec: (track) => {
        const t = squash(track ?? "");
        if (master) return { name: t.replace(/^(I{1,2}|\d)\s+/i, "") || "Master ETcTI", degree: "master" };
        if (/\beng/i.test(t)) return { ...ETC_DOMAIN, name: `${ETC_DOMAIN.name} (engleză)`, code: "ETcTI-EN" };
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

  normalize(parsed, source) {
    const sheet = squash(parsed.sheet);
    if (/^IM an /i.test(sheet)) {
      const im: SpecRef = { name: "Inginerie și management", code: "IM", degree: "bachelor" };
      return genericNormalize(parsed, source, {
        degree: "bachelor",
        spec: () => im,
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
        return [{ ...g, spec: { name: g.name, code: g.name.split(/[ /(]/)[0], degree: "master" as const }, name: "" }];
      });
      const entries = base.entries
        .map((e) => ({ ...e, groups: e.groups.filter((i) => keep.has(i)).map((i) => keep.get(i)!) }))
        .filter((e) => e.groups.length);
      return { groups, entries, warnings: base.warnings };
    }
    return null;
  },
};

/** Facultatea de Științe ale Comunicării: one small workbook per programme. */
export const fscAdapter: FacultyAdapter = {
  slug: "facultatea-de-stiinte-ale-comunicarii",

  classify(link, guess) {
    if (guess.format !== "xlsx" || !/orar/i.test(decodeURIComponent(link.url))) return null;
    return { ...guess, kind: "timetable" };
  },

  normalize(parsed, source) {
    const code = /ORAR_([A-Z]+)_/i.exec(decodeURIComponent(source.url))?.[1] ?? null;
    const master = code ? ["CRPMD", "CA", "CSASD", "TINT"].includes(code.toUpperCase()) : false;
    const spec: SpecRef = { name: squash(source.label), code, degree: master ? "master" : "bachelor" };
    // Sheets are named "CRP an I", "CA I" or "CAII": the year is the trailing numeral.
    const tail = /(III|II|I|IV)\s*$/.exec(squash(parsed.sheet))?.[1];
    const year = parsed.year ?? (tail ? romanToInt(tail) : null);
    return genericNormalize(parsed, source, { degree: spec.degree, year, spec: () => spec, series: () => "" });
  },
};
