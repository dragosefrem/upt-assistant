import { createHash } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { DB } from "@/db";
import {
  courses,
  entries,
  entryGroups,
  examSpecializations,
  exams,
  faculties,
  groups,
  specializations,
  users,
  type Degree,
} from "@/db/schema";
import type { Catalog } from "./catalog";
import { acronym, slugify } from "./text";
import type { NormalizedExam, NormalizedTimetable, SpecRef } from "./types";

/** Writes scraped data into the database. Everything here is synchronous SQLite. */

export function specSlug(name: string, language?: string | null): string {
  const lang = (language ?? "")
    .toUpperCase()
    .split(/[\s,/]+/)
    .filter((l) => l && l !== "RO")
    .join("-")
    .toLowerCase();
  return slugify(name) + (lang ? `-${lang}` : "");
}

const sha = (s: string) => createHash("sha1").update(s).digest("hex");

export function applyCatalog(db: DB, catalog: Catalog) {
  let facultyCount = 0;
  let specCount = 0;
  db.transaction((tx) => {
    for (const f of catalog.faculties) {
      const values = {
        name: f.name,
        shortName: f.shortName,
        website: f.website,
        scheduleUrl: f.scheduleUrl,
        address: f.address,
        lat: f.lat,
        lng: f.lng,
      };
      const row = tx
        .insert(faculties)
        .values({ slug: f.slug, ...values })
        .onConflictDoUpdate({ target: faculties.slug, set: values })
        .returning({ id: faculties.id })
        .get();
      facultyCount++;
      for (const s of f.specializations) {
        const slug = specSlug(s.name, s.language);
        const set = {
          name: s.name,
          domain: s.domain,
          language: s.language,
          durationYears: s.durationYears,
          url: s.url,
        };
        tx.insert(specializations)
          .values({ facultyId: row.id, degree: s.degree, slug, source: "catalog", ...set })
          .onConflictDoUpdate({
            target: [specializations.facultyId, specializations.degree, specializations.slug],
            set,
          })
          .run();
        specCount++;
      }
    }
  });
  return { faculties: facultyCount, specializations: specCount };
}

export class Importer {
  private specs: Array<typeof specializations.$inferSelect>;
  private readonly specCache = new Map<string, number | null>();
  private readonly groupCache = new Map<string, number>();

  constructor(
    private readonly db: DB,
    private readonly facultyId: number,
    private readonly semesterId: number,
  ) {
    this.specs = db.select().from(specializations).where(eq(specializations.facultyId, facultyId)).all();
  }

  /** Finds the catalog specialization a timetable heading refers to, creating one if new. */
  resolveSpec(ref: SpecRef, create: boolean): number | null {
    const cacheKey = `${ref.degree}|${ref.code ?? ""}|${ref.name}|${ref.language ?? ""}|${create}`;
    const cached = this.specCache.get(cacheKey);
    if (cached !== undefined) return cached;

    const code = ref.code?.toLowerCase();
    const withLang = specSlug(ref.name, ref.language);
    const plain = slugify(ref.name);
    const other: Degree = ref.degree === "bachelor" ? "master" : "bachelor";
    const tests: Array<(s: (typeof this.specs)[number]) => boolean> = [
      (s) => !!code && s.degree === ref.degree && s.code?.toLowerCase() === code,
      (s) => s.degree === ref.degree && s.slug === withLang,
      (s) => s.degree === ref.degree && s.slug === plain,
      (s) => !!code && s.degree === ref.degree && acronym(s.name).toLowerCase() === code,
      // Sheets are not always clear about the cycle; accept the other one before
      // inventing a duplicate.
      (s) => s.degree === other && (s.slug === withLang || s.slug === plain),
    ];
    let match: (typeof this.specs)[number] | undefined;
    for (const test of tests) {
      match = this.specs.find(test);
      if (match) break;
    }

    let id: number | null = match?.id ?? null;
    if (match && ref.code && !match.code) {
      this.db.update(specializations).set({ code: ref.code }).where(eq(specializations.id, match.id)).run();
      match.code = ref.code;
    }
    if (!match && create) {
      const row = this.db
        .insert(specializations)
        .values({
          facultyId: this.facultyId,
          degree: ref.degree,
          name: ref.name,
          slug: withLang,
          code: ref.code ?? null,
          language: ref.language ?? null,
          source: "schedule",
        })
        .returning()
        .get();
      this.specs.push(row);
      id = row.id;
    }
    this.specCache.set(cacheKey, id);
    return id;
  }

  private resolveGroup(specId: number, year: number, series: string, name: string): number {
    const key = `${specId}|${year}|${series}|${name}`;
    const cached = this.groupCache.get(key);
    if (cached) return cached;
    const row = this.db
      .insert(groups)
      .values({ specializationId: specId, year, series, name })
      .onConflictDoUpdate({
        target: [groups.specializationId, groups.year, groups.series, groups.name],
        set: { name },
      })
      .returning({ id: groups.id })
      .get();
    this.groupCache.set(key, row.id);
    return row.id;
  }

  /** Replaces everything previously imported from one source with `tables`. */
  importTimetable(sourceId: number, tables: NormalizedTimetable[]) {
    const stats = { entries: 0, courses: 0, groups: 0 };
    this.db.transaction(() => {
      const keep = new Set<string>();
      const seenCourses = new Set<number>();
      const seenGroups = new Set<number>();

      for (const table of tables) {
        const groupIds = table.groups.map((g) =>
          this.resolveGroup(this.resolveSpec(g.spec, true)!, g.year, g.series, g.name),
        );
        groupIds.forEach((id) => seenGroups.add(id));

        for (const e of table.entries) {
          const ids = [...new Set(e.groups.map((i) => groupIds[i]))].sort((a, b) => a - b);
          if (!ids.length) continue;
          const year = table.groups[e.groups[0]].year;
          const courseKey = `${this.facultyId}:${this.semesterId}:${year}:${slugify(e.courseName)}`;
          const course = this.db
            .insert(courses)
            .values({
              key: courseKey,
              semesterId: this.semesterId,
              facultyId: this.facultyId,
              name: e.courseName,
              abbreviation: e.courseAbbr,
              year,
            })
            // `isOptional` is an admin decision (timetables do not state it), so a
            // re-scrape leaves it alone.
            .onConflictDoUpdate({
              target: courses.key,
              set: { abbreviation: sql`coalesce(${courses.abbreviation}, ${e.courseAbbr})` },
            })
            .returning({ id: courses.id })
            .get();
          seenCourses.add(course.id);

          const key = sha(
            [sourceId, e.sheet, e.day, e.startMin, e.endMin, e.kind, slugify(e.courseName), ids.join(","), e.room ?? "", e.weeks].join("|"),
          );
          if (keep.has(key)) continue;
          keep.add(key);
          const values = {
            semesterId: this.semesterId,
            sourceId,
            courseId: course.id,
            kind: e.kind,
            day: e.day,
            startMin: e.startMin,
            endMin: e.endMin,
            weeks: e.weeks,
            room: e.room,
            teacher: e.teacher,
            rawText: e.rawText,
            isSlotOption: e.isSlotOption,
          };
          const row = this.db
            .insert(entries)
            .values({ key, ...values })
            .onConflictDoUpdate({ target: entries.key, set: values })
            .returning({ id: entries.id })
            .get();
          this.db.delete(entryGroups).where(eq(entryGroups.entryId, row.id)).run();
          this.db.insert(entryGroups).values(ids.map((groupId) => ({ entryId: row.id, groupId }))).run();
          stats.entries++;
        }
      }

      // Entries this source no longer contains.
      const stale = keep.size
        ? and(eq(entries.sourceId, sourceId), notInArray(entries.key, [...keep]))
        : eq(entries.sourceId, sourceId);
      this.db.delete(entries).where(stale).run();
      stats.courses = seenCourses.size;
      stats.groups = seenGroups.size;
    });
    return stats;
  }

  importExams(sourceId: number, session: string, list: NormalizedExam[]) {
    let imported = 0;
    this.db.transaction(() => {
      const known = this.db
        .select({ name: courses.name, abbreviation: courses.abbreviation, year: courses.year })
        .from(courses)
        .where(eq(courses.facultyId, this.facultyId))
        .all();
      const keep: string[] = [];
      for (const e of list) {
        const abbr = e.courseAbbr?.toLowerCase();
        const full =
          known.find((c) => abbr && c.abbreviation?.toLowerCase() === abbr && c.year === e.year) ??
          known.find((c) => abbr && c.abbreviation?.toLowerCase() === abbr);
        const key = sha([sourceId, e.date, e.startMin, e.room ?? "", e.rawText].join("|"));
        if (keep.includes(key)) continue;
        keep.push(key);
        const values = {
          facultyId: this.facultyId,
          sourceId,
          session,
          courseName: full?.name ?? e.courseName,
          courseAbbr: e.courseAbbr,
          date: e.date,
          startMin: e.startMin,
          endMin: e.endMin,
          room: e.room,
          teacher: e.teacher,
          audience: e.audience,
          year: e.year,
          rawText: e.rawText,
        };
        const row = this.db
          .insert(exams)
          .values({ key, ...values })
          .onConflictDoUpdate({ target: exams.key, set: values })
          .returning({ id: exams.id })
          .get();
        this.db.delete(examSpecializations).where(eq(examSpecializations.examId, row.id)).run();
        const specIds = [...new Set(e.specs.map((s) => this.resolveSpec(s, false)).filter((id): id is number => id !== null))];
        if (specIds.length) {
          this.db
            .insert(examSpecializations)
            .values(specIds.map((specializationId) => ({ examId: row.id, specializationId })))
            .run();
        }
        imported++;
      }
      const stale = keep.length
        ? and(eq(exams.sourceId, sourceId), notInArray(exams.key, keep))
        : eq(exams.sourceId, sourceId);
      this.db.delete(exams).where(stale).run();
    });
    return imported;
  }

  /** Removes courses and groups nothing refers to any more. */
  prune() {
    this.db.run(sql`
      DELETE FROM courses
      WHERE faculty_id = ${this.facultyId} AND semester_id = ${this.semesterId}
        AND id NOT IN (SELECT course_id FROM entries)`);
    const specIds = this.specs.map((s) => s.id);
    if (!specIds.length) return;
    const used = this.db.selectDistinct({ id: entryGroups.groupId }).from(entryGroups).all().map((r) => r.id);
    const picked = this.db
      .selectDistinct({ id: users.groupId })
      .from(users)
      .all()
      .map((r) => r.id)
      .filter((id): id is number => id !== null);
    const keepIds = [...new Set([...used, ...picked])];
    this.db
      .delete(groups)
      .where(
        keepIds.length
          ? and(inArray(groups.specializationId, specIds), notInArray(groups.id, keepIds))
          : inArray(groups.specializationId, specIds),
      )
      .run();
  }
}
