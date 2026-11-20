import "server-only";
import { asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { faculties, groups, specializations } from "@/db/schema";

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
      .orderBy(asc(specializations.name))
      .all(),
    groups: db
      .select({ id: groups.id, specializationId: groups.specializationId, year: groups.year, series: groups.series, name: groups.name })
      .from(groups)
      .orderBy(asc(groups.series), asc(groups.name))
      .all(),
  };
}

export function facultyOf(id: number | null) {
  return id ? getDb().select().from(faculties).where(eq(faculties.id, id)).get() ?? null : null;
}
