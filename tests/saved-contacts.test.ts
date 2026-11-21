import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { faculties, groups, savedContacts, specializations, users } from "@/db/schema";
import {
  groupChoice, listSavedContacts, matchGroups, removeSavedContact, saveContact, SavedContactError, savedNameKey,
} from "@/lib/saved-contacts";

vi.stubEnv("DATABASE_PATH", ":memory:");
const db = getDb();
let ac: number;
let etc: number;
const group = (spec: number, year: number, name: string) =>
  db.insert(groups).values({ specializationId: spec, year, name }).returning().get().id;
const ids: Record<string, number> = {};

beforeEach(() => {
  db.delete(users).run();
  db.delete(faculties).run();
  for (const id of ["ana", "bob"]) {
    db.insert(users).values({ id, name: id, email: `${id}@example.org`, passwordHash: "test", feedToken: id }).run();
  }
  ac = db.insert(faculties).values({ name: "Automatică și Calculatoare", shortName: "AC", slug: "ac" }).returning().get().id;
  etc = db.insert(faculties).values({ name: "Electronică", shortName: "ETC", slug: "etc" }).returning().get().id;
  const ti = db.insert(specializations).values({ name: "Tehnologia informației", code: "TI", slug: "ti", degree: "bachelor", facultyId: ac }).returning().get().id;
  const calc = db.insert(specializations).values({ name: "Calculatoare", code: "C", slug: "c", degree: "bachelor", facultyId: ac }).returning().get().id;
  const tst = db.insert(specializations).values({ name: "Telecomunicații", code: "TST", slug: "tst", degree: "bachelor", facultyId: etc }).returning().get().id;
  ids.ti2 = group(ti, 2, "3.2");
  ids.ti3 = group(ti, 3, "3.2");
  ids.c21 = group(calc, 2, "2.1");
  ids.c22 = group(calc, 2, "2.2");
  ids.tst = group(tst, 1, "4.1");
});
afterAll(() => vi.unstubAllEnvs());

describe("saved contacts", () => {
  it("adds, updates by accent- and case-insensitive name, lists and removes, scoped to the user", () => {
    expect(savedNameKey("  Ștefan ")).toBe("stefan");
    const first = saveContact("ana", "  Ștefan  Pop ", ids.ti2);
    expect(first).toMatchObject({ name: "Ștefan Pop", created: true });
    expect(saveContact("ana", "Mindy", ids.c21).created).toBe(true);
    const again = saveContact("ana", "STEFAN pop", ids.ti3);
    expect(again).toEqual({ id: first.id, name: "STEFAN pop", created: false });
    saveContact("bob", "Mindy", ids.tst);

    expect(listSavedContacts("ana")).toEqual([
      { id: expect.any(Number), name: "Mindy", groupId: ids.c21, group: { groupId: ids.c21, group: "Calculatoare, year 2, 2.1", code: "C", faculty: "AC" } },
      { id: first.id, name: "STEFAN pop", groupId: ids.ti3, group: { groupId: ids.ti3, group: "Tehnologia informației, year 3, 3.2", code: "TI", faculty: "AC" } },
    ]);
    expect(listSavedContacts("ana", "ro")[0].group?.group).toBe("Calculatoare, anul 2, 2.1");

    expect(removeSavedContact("bob", first.id)).toBe(false);
    expect(removeSavedContact("ana", first.id)).toBe(true);
    expect(removeSavedContact("ana", first.id)).toBe(false);
    expect(listSavedContacts("ana").map((c) => c.name)).toEqual(["Mindy"]);
    expect(listSavedContacts("bob")).toMatchObject([{ name: "Mindy", groupId: ids.tst }]);
  });

  it("rejects empty or long names and groups that no longer exist", () => {
    const code = (fn: () => unknown) => { try { fn(); } catch (e) { return e instanceof SavedContactError ? e.code : e; } };
    expect(code(() => saveContact("ana", "   ", ids.ti2))).toBe("name");
    expect(code(() => saveContact("ana", "x".repeat(61), ids.ti2))).toBe("nameTooLong");
    expect(code(() => saveContact("ana", "Mindy", 999_999))).toBe("groupGone");
    expect(db.select().from(savedContacts).all()).toHaveLength(0);
  });

  it("keeps the person when their group leaves the timetable", () => {
    saveContact("ana", "Mindy", ids.tst);
    db.delete(groups).where(eq(groups.id, ids.tst)).run();
    expect(listSavedContacts("ana")).toEqual([{ id: expect.any(Number), name: "Mindy", groupId: null, group: null }]);
    expect(groupChoice(ids.tst)).toBeNull();
  });
});

describe("matching a loosely typed group", () => {
  it("offers equally likely groups, own year first, and resolves precise queries to one", () => {
    expect(matchGroups("TI 3.2", ac, 3).map((g) => g.groupId)).toEqual([ids.ti3, ids.ti2]);
    expect(matchGroups("TI 3.2 anul 2", ac, 3).map((g) => g.groupId)).toEqual([ids.ti2]);
    expect(matchGroups("TI year 3 3.2", ac, 2).map((g) => g.groupId)).toEqual([ids.ti3]);
    expect(matchGroups("2.1 anul 2", ac, 1).map((g) => g.groupId)).toEqual([ids.c21]);
    expect(matchGroups("Calculatoare anul 2 2.1", ac, 1)).toEqual([
      { groupId: ids.c21, group: "Calculatoare, year 2, 2.1", code: "C", faculty: "AC" },
    ]);
  });

  it("searches the student's faculty first, then every faculty, and reports no match", () => {
    expect(matchGroups("TST 4.1", ac, 1, "ro")).toEqual([{ groupId: ids.tst, group: "Telecomunicații, anul 1, 4.1", code: "TST", faculty: "ETC" }]);
    expect(matchGroups("Tehnologia 3.2", etc, null).map((g) => g.groupId).sort()).toEqual([ids.ti2, ids.ti3].sort());
    expect(matchGroups("zzz 9.9", ac, 1)).toEqual([]);
    expect(matchGroups("   ", ac, 1)).toEqual([]);
  });
});
