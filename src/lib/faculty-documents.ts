import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { sources, timetablePdfs } from "@/db/schema";

export function facultyDocuments(facultyId: number | null, kind: "timetable" | "exams",
  semester?: { academicYear: string; number: number } | null) {
  if (!facultyId || (kind === "timetable" && !semester)) return [];
  const term = kind === "timetable" && semester
    ? and(eq(sources.academicYear, semester.academicYear), eq(sources.semester, semester.number))
    : undefined;
  return getDb().select({
    id: sources.id, kind: sources.kind, label: sources.label, url: sources.url, status: sources.status,
    format: sources.format, message: sources.message, lastFetchedAt: sources.lastFetchedAt, pdfId: timetablePdfs.sourceId,
  }).from(sources).leftJoin(timetablePdfs, eq(timetablePdfs.sourceId, sources.id))
    .where(and(eq(sources.facultyId, facultyId), eq(sources.kind, kind), term)).orderBy(asc(sources.label)).all();
}
