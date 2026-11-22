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
        // upt.ro serves some names with the diacritics as separate marks ("a" + "˘"). Stored that
        // way, "Facultatea de Mecanică" would not equal itself typed on a keyboard.
        name: f.name.normalize("NFC"),
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
          name: s.name.normalize("NFC"),
          domain: s.domain,
          language: s.language,
          durationYears: s.durationYears,
          url: s.url,
          source: "catalog" as const,
        };
        tx.insert(specializations)
          .values({ facultyId: row.id, degree: s.degree, slug, ...set })
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
    const candidates = this.specs.filter((s) => s.degree === ref.degree &&
      (!ref.language || specSlug("", s.language) === specSlug("", ref.language)));
    const unique = (rows: typeof candidates) => rows.length === 1 ? rows[0] : undefined;
    const named = candidates.filter((s) => slugify(s.name) === slugify(ref.name));
    const match = candidates.find((s) => s.slug === withLang && (ref.language || s.source === "catalog"))
      ?? unique(named.filter((s) => s.source === "catalog"))
      ?? unique(named)
      ?? (code && !named.length ? unique(candidates.filter((s) =>
        s.code?.toLowerCase() === code || acronym(s.name).toLowerCase() === code)) : undefined)
      ?? candidates.find((s) => s.slug === withLang);

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
    if (create && id !== null && ref.previousSlugs?.length) {
      for (const old of this.specs.filter((s) => s.degree === ref.degree && s.id !== id && ref.previousSlugs!.includes(s.slug))) {
        this.moveProgramme(old.id, id);
        if (old.source === "schedule") {
          this.db.delete(specializations).where(eq(specializations.id, old.id)).run();
          this.specs = this.specs.filter((s) => s.id !== old.id);
        }
      }
    }
    this.specCache.set(cacheKey, id);
    return id;
  }

  /** Preserve selected groups, exams and entry IDs when a previous importer used an alias. */
  private moveProgramme(from: number, to: number) {
    for (const group of this.db.select().from(groups).where(eq(groups.specializationId, from)).all()) {
      const target = this.db.select().from(groups).where(and(eq(groups.specializationId, to),
        eq(groups.year, group.year), eq(groups.series, group.series), eq(groups.name, group.name))).get();
      if (target) {
        this.db.run(sql`INSERT OR IGNORE INTO entry_groups (entry_id, group_id)
          SELECT entry_id, ${target.id} FROM entry_groups WHERE group_id = ${group.id}`);
        this.db.update(users).set({ groupId: target.id }).where(eq(users.groupId, group.id)).run();
        this.db.delete(groups).where(eq(groups.id, group.id)).run();
      } else {
        this.db.update(groups).set({ specializationId: to }).where(eq(groups.id, group.id)).run();
      }
    }
    this.db.update(users).set({ specializationId: to }).where(eq(users.specializationId, from)).run();
    this.db.run(sql`INSERT OR IGNORE INTO exam_specializations (exam_id, specialization_id)
      SELECT exam_id, ${to} FROM exam_specializations WHERE specialization_id = ${from}`);
    this.db.delete(examSpecializations).where(eq(examSpecializations.specializationId, from)).run();
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

        // Some printed sheets put several study years in one grid. A course
        // belongs to one year even when those years attend a lecture together.
        const byStudyYear = table.entries.flatMap((entry) => {
          const audiences = new Map<number, number[]>();
          for (const index of entry.groups) {
            const year = table.groups[index].year;
            const audience = audiences.get(year) ?? [];
            audience.push(index);
            audiences.set(year, audience);
          }
          return [...audiences.values()].map((groups) => ({ ...entry, groups }));
        });
        for (const e of byStudyYear) {
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
            // Keep the administrator's faculty-wide optional-course override.
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
            publishedOptional: e.publishedOptional ?? false,
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
        const abbr = e.courseName === e.courseAbbr ? e.courseAbbr.toLowerCase() : null;
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
    // When the source withdraws a duplicate label and publishes one group for the
    // cohort, an existing profile still refers to that same cohort.
    this.db.run(sql`
      WITH active AS (
        SELECT DISTINCT g.id, g.specialization_id, g.year, g.series
        FROM groups g JOIN entry_groups eg ON eg.group_id = g.id JOIN entries e ON e.id = eg.entry_id
        JOIN specializations sp ON sp.id = g.specialization_id
        WHERE sp.faculty_id = ${this.facultyId} AND e.semester_id = ${this.semesterId}
      ), sole AS (
        SELECT specialization_id, year, series, min(id) AS id
        FROM active GROUP BY specialization_id, year, series HAVING count(*) = 1
      )
      UPDATE users SET group_id = sole.id
      FROM groups old JOIN sole USING (specialization_id, year, series)
      WHERE users.group_id = old.id AND old.id <> sole.id`);
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
