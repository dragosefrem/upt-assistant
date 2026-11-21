import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { faculties, groups, specializations, users } from "@/db/schema";
import { contactDirectory, groupParts } from "@/lib/contact-directory";
import { answerContact, contactList, inviteContactById } from "@/lib/contacts";

vi.stubEnv("DATABASE_PATH", ":memory:");
const db = getDb();

function programme(code: string) {
  const faculty = db.insert(faculties).values({ slug: code, name: code, shortName: code }).returning().get();
  return db.insert(specializations).values({ name: code, code, slug: code, degree: "bachelor", facultyId: faculty.id }).returning().get();
}

function group(spec: ReturnType<typeof programme>, name: string, year = 2, series = "Seria A") {
  const row = db.insert(groups).values({ specializationId: spec.id, name, year, series }).returning().get();
  return { groupId: row.id, specializationId: spec.id, facultyId: spec.facultyId, year };
}

function student(id: string, name: string, study?: Partial<ReturnType<typeof group>>) {
  return db.insert(users).values({ id, name, email: `${id}@example.org`, passwordHash: "test", feedToken: id, ...study }).returning().get();
}

beforeEach(() => { db.delete(users).run(); db.delete(faculties).run(); });
afterAll(() => vi.unstubAllEnvs());

describe("contact discovery", () => {
  it("finds names across programmes, in either order, without using or returning e-mail addresses", () => {
    const me = student("viewer", "Ștefan Dănilă");
    const study = group(programme("AC"), "2.1");
    student("first", "Ștefan Dănilă", { groupId: study.groupId });
    student("second", "Ștefan Dănilă");
    student("stefan", "Mihai Ionescu", study);
    const results = contactDirectory(me, { name: "  DANI   şte  " });
    expect(results.people.map((p) => p.id)).toEqual(["first", "second"]);
    expect(results.people[0]).toMatchObject({ year: 2, groupName: "2.1", series: "Seria A", faculty: "AC" });
    expect(results.people[1]).toMatchObject({ year: null, groupName: null });
    expect(results.people[0]).not.toHaveProperty("email");
    for (const name of ["stefan@example.org", "%", "_", " ", "\u0301", "a ".repeat(160)]) {
      expect(contactDirectory(me, { name }).people).toEqual([]);
    }
  });

  it("browses every sibling subgroup only within the same programme, year, series and parent group", () => {
    const ac = programme("AC");
    const own = group(ac, "1.1");
    const me = student("viewer", "Viewer", own);
    student("a", "Ana", own);
    student("b", "Bogdan", group(ac, "1.2"));
    student("prefix", "Other group", group(ac, "10.1"));
    student("year", "Other year", group(ac, "1.1", 3));
    student("series", "Other series", group(ac, "1.1", 2, "Seria B"));
    student("programme", "Other programme", group(programme("CT"), "1.1"));
    expect(contactDirectory(me, {}).people.map((p) => p.id)).toEqual(["a", "b"]);
    expect(contactDirectory(me, { scope: "subgroup" }).people.map((p) => p.id)).toEqual(["a"]);
    expect(contactDirectory(me, { name: "Other programme" }).total).toBe(1);
    expect(contactDirectory(student("unassigned", "New student"), {})).toMatchObject({ cohort: null, total: 0 });
  });

  it("keeps whole-year and undivided groups usable when no subgroup is published", () => {
    const ac = programme("AC");
    const wholeYear = group(ac, "");
    const me = student("viewer", "Viewer", wholeYear);
    student("classmate", "A classmate", wholeYear);
    const unsplit = student("other", "Another student", group(ac, "Group 2"));
    expect(contactDirectory(me, { scope: "subgroup" })).toMatchObject({ scope: "group", total: 1, cohort: { subgroup: null } });
    expect(contactDirectory(unsplit, {})).toMatchObject({ total: 0, cohort: { group: "2", subgroup: null } });
  });

  it.each([
    ["AC", "1.2", "1", "1.2"], ["IEE", "2/1", "2", "2/1"], ["FIH", "2/3", null, "2/3"],
    ["MEC", "Grupa A sgr. 2", "A", "2"], ["MEC", "GR.1 sgr 2", "1", "2"],
    ["RIA", "Grupa 3 - Dual sgr. 1", "3 - Dual", "1"], ["RIA", "Grupa 2 2/1", "2", "2/1"],
    ["CT", "111 a", "111", "111 a"], ["CHIM", "1B", "1", "1B"], ["FSC", "1 franceză", "1 franceză", null],
  ] as const)("interprets the %s timetable label %s", (faculty, label, parent, subgroup) => {
    expect(groupParts(label, faculty)).toEqual({ group: parent, subgroup });
  });

  it("paginates duplicate names deterministically and sends the invitation only to the selected ID", () => {
    const study = group(programme("AC"), "1.2");
    const me = student("viewer", "Viewer", study);
    for (let i = 0; i < 12; i++) student(`id-${i}`, "Ana Pop", study);
    for (const params of [{}, { name: "Ana" }]) {
      const first = contactDirectory(me, params);
      const last = contactDirectory(me, { ...params, page: "9999" });
      expect(last).toMatchObject({ page: 2, pages: 2, total: 12 });
      expect(new Set([...first.people, ...last.people].map((p) => p.id)).size).toBe(12);
    }
    inviteContactById(me.id, "id-9");
    inviteContactById(me.id, "id-9");
    inviteContactById("id-9", me.id);
    expect(contactList(me.id)).toMatchObject([{ id: "id-9", requestedBy: me.id, accepted: false, groupName: "1.2" }]);
    answerContact("id-9", me.id, true);
    inviteContactById(me.id, "id-9");
    expect(contactList(me.id)).toMatchObject([{ id: "id-9", accepted: true }]);
    expect(() => inviteContactById(me.id, me.id)).toThrow(/another person/);
    expect(() => inviteContactById(me.id, "missing")).toThrow(/no longer available/);
  });
});
