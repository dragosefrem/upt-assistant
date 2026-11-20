import type { Degree } from "@/db/schema";
import type { ParsedTimetable } from "../timetable";
import { parseStudyYear, squash } from "../text";
import type { DiscoveredSource, NormalizedTimetable, SpecRef } from "../types";

/** Strips a trailing "(CODE)" from a heading and returns both parts. */
export function splitCode(label: string): { name: string; code: string | null } {
  const m = /^(.*?)\s*\(([\p{Lu}\d-]{1,8})\)\s*$/u.exec(squash(label));
  return m ? { name: m[1], code: m[2] } : { name: squash(label), code: null };
}

export function titleCase(s: string): string {
  if (s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function guessDegree(...texts: string[]): Degree {
  return texts.some((t) => /master|disert/i.test(t)) ? "master" : "bachelor";
}

/**
 * Faculty-agnostic mapping: each track heading becomes a specialization; sheets with
 * no track fall back to the link label or sheet name.
 */
export function genericNormalize(
  parsed: ParsedTimetable,
  source: DiscoveredSource,
  overrides: {
    degree?: Degree;
    year?: number | null;
    spec?: (track: string | null) => SpecRef | null;
    series?: (track: string | null) => string;
  } = {},
): NormalizedTimetable | null {
  if (!parsed.entries.length) return null;
  const degree = overrides.degree ?? guessDegree(source.label, source.context, parsed.sheet, parsed.title);
  const year =
    overrides.year ?? parsed.year ?? parseStudyYear(source.label) ?? parseStudyYear(source.context);
  if (!year) {
    return {
      groups: [],
      entries: [],
      warnings: [`Sheet "${parsed.sheet}": could not tell which study year it is for; skipped.`],
    };
  }

  const fallbackName = (): string => {
    const fromSheet = squash(parsed.sheet.replace(/\ban(?:ul)?\.?\s*(?:I{1,3}|IV|V|VI|\d)\b/gi, " "));
    const label = squash(source.label);
    if (label && !/\b(orar|semestr|sem\.)/i.test(label) && label.length <= 90) return label;
    return fromSheet || label || "General";
  };

  const groups = parsed.groups.map((g) => {
    const custom = overrides.spec?.(g.track);
    let spec: SpecRef;
    if (custom) spec = custom;
    else if (g.track && !overrides.series) {
      const { name, code } = splitCode(g.track);
      spec = { name: titleCase(name), code, degree };
    } else spec = { name: fallbackName(), degree };
    return { spec, year, series: overrides.series?.(g.track) ?? "", name: g.name };
  });

  return {
    groups,
    entries: parsed.entries.map((e) => ({ ...e, sheet: parsed.sheet })),
    warnings: parsed.warnings.map((w) => `Sheet "${parsed.sheet}": ${w}`),
  };
}
