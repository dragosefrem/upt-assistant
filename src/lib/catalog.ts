import "server-only";
import { asc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { entries, entryGroups, faculties, groups, semesters, specializations } from "@/db/schema";

/** The structure a student picks from: faculty → cycle → specialization → year → group. */
export interface PickerData {
  faculties: Array<{ id: number; name: string; shortName: string | null; scheduleUrl: string | null }>;
  specializations: Array<{
    id: number;
    facultyId: number;
    degree: "bachelor" | "master";
    name: string;
    code: string | null;
    language: string | null;
    domain: string | null;
    durationYears: number | null;
  }>;
  groups: Array<{ id: number; specializationId: number; year: number; series: string; name: string }>;
}

export function pickerData(): PickerData {
  const db = getDb();
  const activeGroups = db
    .selectDistinct({ id: groups.id, specializationId: groups.specializationId, year: groups.year, series: groups.series, name: groups.name })
    .from(groups)
    .innerJoin(entryGroups, eq(entryGroups.groupId, groups.id))
    .innerJoin(entries, eq(entries.id, entryGroups.entryId))
    .innerJoin(semesters, eq(semesters.id, entries.semesterId))
    .where(eq(semesters.isCurrent, true))
    .orderBy(asc(groups.series), asc(groups.name))
    .all();
  return {
    faculties: db
      .select({ id: faculties.id, name: faculties.name, shortName: faculties.shortName, scheduleUrl: faculties.scheduleUrl })
      .from(faculties)
      .orderBy(asc(faculties.name))
      .all(),
    specializations: db
      .select({
        id: specializations.id,
        facultyId: specializations.facultyId,
        degree: specializations.degree,
        name: specializations.name,
        code: specializations.code,
        language: specializations.language,
        domain: specializations.domain,
        durationYears: specializations.durationYears,
      })
      .from(specializations)
      .where(or(eq(specializations.source, "catalog"), inArray(specializations.id, [...new Set(activeGroups.map((g) => g.specializationId))])))
      .orderBy(asc(specializations.name))
      .all(),
    groups: activeGroups,
  };
}

/** Where students can check for a timetable before their group has been published here. */
export function programmeTimetable(specializationId: number | null) {
  if (!specializationId) return null;
  return getDb().select({ name: specializations.name, facultyUrl: faculties.scheduleUrl })
    .from(specializations).innerJoin(faculties, eq(specializations.facultyId, faculties.id))
    .where(eq(specializations.id, specializationId)).get() ?? null;
}

export function facultyOf(id: number | null) {
  return id ? getDb().select().from(faculties).where(eq(faculties.id, id)).get() ?? null : null;
}
