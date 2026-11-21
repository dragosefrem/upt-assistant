import type { PickerData } from "./catalog";

type Programme = PickerData["specializations"][number];

/** In common years the faculty publishes the domain; in split years it publishes
 * its individual specializations. Only offer the published level for that year. */
export function programmeOptions(specs: Programme[], groups: PickerData["groups"], year: number | null) {
  const active = new Set(groups.filter((g) => g.year === year).map((g) => g.specializationId));
  const scheduled = specs.filter((s) => active.has(s.id));
  const other = specs.filter((s) => {
    if (active.has(s.id) || (s.durationYears && year && year > s.durationYears)) return false;
    return !s.domain || !scheduled.some((t) => t.facultyId === s.facultyId && t.degree === s.degree &&
      t.domain === s.domain && t.language === s.language &&
      (t.name === s.name || s.name === s.domain || t.name === t.domain));
  });
  return { scheduled, other };
}
