import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { entries, faculties, groups, sources, specializations, users } from "@/db/schema";
import { pickerData } from "@/lib/catalog";
import { exportItems, toICS } from "@/lib/export";
import { programmeOptions } from "@/lib/profile-options";
import { courseChoices, currentSemester, eventsBetween } from "@/lib/schedule";
import { Importer, specSlug } from "@/scraper/apply";
import type { NormalizedEntry, SpecRef } from "@/scraper/types";

it("keeps saved groups and exports when the timetable moves from a shared domain to the correct programme", () => {
  vi.stubEnv("DATABASE_PATH", ":memory:");
  const db = getDb();
  const semester = currentSemester()!;
  const faculty = db.insert(faculties).values({ name: "Automatică și Calculatoare", slug: "ac" }).returning().get();
  const source = db.insert(sources).values({ facultyId: faculty.id, url: "https://faculty.example/cti.xlsx",
    label: "CTI", format: "xlsx", kind: "timetable" }).returning().get();
  const domain = "Calculatoare și tehnologia informației";
  const programme = (name: string, code: string, language: string, degree: SpecRef["degree"] = "bachelor") =>
    db.insert(specializations).values({ facultyId: faculty.id, degree, domain, name, code, language,
      slug: specSlug(name, language), durationYears: degree === "bachelor" ? 4 : 2 }).returning().get();
  const common = programme(domain, "CTI", "RO");
  const old = programme(domain, "CTI-EN", "EN");
  const ro = programme("Calculatoare", "C", "RO");
  const en = programme("Calculatoare", "C-EN", "EN");
  programme("Calculatoare", "C", "RO", "master");
  const legacyGroup = db.insert(groups).values({ specializationId: old.id, year: 2, name: "1.1" }).returning().get();
  const viewer = db.insert(users).values({ id: "test", name: "Student", email: "student@example.test", passwordHash: "",
    feedToken: "test", year: 2, groupId: legacyGroup.id, facultyId: faculty.id, specializationId: old.id }).returning().get();
  const entry: NormalizedEntry = { sheet: "An 2 Eng", courseName: "Data Structures", courseAbbr: null,
    day: 1, startMin: 480, endMin: 600, room: "A101", teacher: null, weeks: "odd&1-7", rawText: "Data Structures",
    groups: [0], kind: "course", isSlotOption: false };
  const english: SpecRef = { name: en.name, degree: en.degree, language: en.language, code: en.code, previousSlugs: [old.slug] };
  const table = { groups: [
    { year: 2, spec: english, series: "", name: "1.1" },
    { year: 2, spec: ro, series: "", name: "1" },
    { year: 1, spec: common, series: "Seria 1", name: "1" },
  ], entries: [entry, { ...entry, courseName: "Optional seminar", publishedOptional: true },
    { ...entry, courseName: "Matematică", groups: [1, 2] }], warnings: [] };
  const importer = () => new Importer(db, faculty.id, semester.id);
  importer().importTimetable(source.id, [table]);
  const ids = db.select({ id: entries.id }).from(entries).all();
  importer().importTimetable(source.id, [table]);
  expect(db.select({ id: entries.id }).from(entries).all()).toEqual(ids);
  const student = db.select().from(users).where(eq(users.id, viewer.id)).get()!;
  expect(student).toMatchObject({ specializationId: en.id, groupId: legacyGroup.id });
  const data = pickerData();
  const bachelor = data.specializations.filter((s) => s.degree === "bachelor");
  expect(programmeOptions(bachelor, data.groups, 1).scheduled.map((s) => s.id)).toEqual([common.id]);
  const second = programmeOptions(bachelor, data.groups, 2);
  expect(second.scheduled.map((s) => s.id).sort()).toEqual([ro.id, en.id].sort());
  expect(second.other).toEqual([]);
  expect(courseChoices(student, semester).find((c) => c.name === "Optional seminar")?.enrolled).toBe(false);
  const exported = exportItems(student);
  expect(exported).toHaveLength(1);
  expect(exported[0]).toMatchObject({ date: "2026-09-28", until: "2026-11-09", title: "Data Structures (Lecture)" });
  expect(toICS(exported)).toContain("DTSTART;TZID=Europe/Bucharest:20260928T080000");
  expect(eventsBetween(student, semester.startDate, semester.endDate).map((e) => e.date))
    .toEqual(["2026-09-28", "2026-10-12", "2026-10-26", "2026-11-09"]);
  vi.unstubAllEnvs();
});
