import "server-only";
import { asc, count, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { courses, entries, exams, faculties, sources } from "@/db/schema";
import { currentSemester } from "./schedule";

export interface LandingStats {
  classes: number;
  exams: number;
  /** Faculties whose timetables are imported (they have classes), by short name. */
  imported: string[];
  /** Faculties with only their exam schedule imported. */
  examsOnly: string[];
  /** Faculties with links to their published documents (PDF and the like) but nothing imported. */
  linked: string[];
  /** Faculties with nothing imported and no document found yet. */
  pending: string[];
}

/** Live numbers for the landing page, so it never claims more than the database holds. */
export function landingStats(): LandingStats {
  const db = getDb();
  // Classes of the current semester only; earlier semesters stay in the database.
  const semester = currentSemester();
  const classes = semester ? (db.select({ n: count() }).from(entries).where(eq(entries.semesterId, semester.id)).get()?.n ?? 0) : 0;
  const examCount = db.select({ n: count() }).from(exams).get()?.n ?? 0;
  const all = db.select({ id: faculties.id, short: faculties.shortName, name: faculties.name }).from(faculties).orderBy(asc(faculties.shortName)).all();
  const withClasses = new Set(
    semester
      ? db
          .select({ id: courses.facultyId })
          .from(courses)
          .innerJoin(entries, eq(entries.courseId, courses.id))
          .where(eq(entries.semesterId, semester.id))
          .groupBy(courses.facultyId)
          .all()
          .map((r) => r.id)
      : [],
  );
  const withDocuments = new Set(db.select({ id: sources.facultyId }).from(sources).groupBy(sources.facultyId).all().map((r) => r.id));
  const withExams = new Set(
    db
      .select({ id: exams.facultyId, n: sql<number>`count(*)` })
      .from(exams)
      .groupBy(exams.facultyId)
      .all()
      .map((r) => r.id),
  );
  const label = (f: (typeof all)[number]) => f.short ?? f.name;
  return {
    classes,
    exams: examCount,
    imported: all.filter((f) => withClasses.has(f.id)).map(label),
    examsOnly: all.filter((f) => !withClasses.has(f.id) && withExams.has(f.id)).map(label),
    linked: all.filter((f) => !withClasses.has(f.id) && !withExams.has(f.id) && withDocuments.has(f.id)).map(label),
    pending: all.filter((f) => !withClasses.has(f.id) && !withExams.has(f.id) && !withDocuments.has(f.id)).map(label),
  };
}

export { formatCount, roCount } from "./landing-format";
