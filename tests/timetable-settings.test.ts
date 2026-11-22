import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { setPrivateSharing } from "@/app/(app)/settings/actions";
import { addExtraCourseAction, removeExtraCourseAction, saveTimetableAction } from "@/app/(app)/timetable-settings/actions";
import { getDb } from "@/db";
import { courses, entries, entryGroups, faculties, groups, personalEvents, specializations, userExtraCourses, userOverrides, users } from "@/db/schema";
import { requireOnboardedUser, type User } from "@/lib/auth";
import { runTool } from "@/lib/assistant/tools";
import { contactEvents } from "@/lib/contact-schedule";
import { isPublicHoliday } from "@/lib/holidays";
import { currentSemester, extraCourseOptions, needsSlot, studentOwnsEntry, studentWeek, timetableReview } from "@/lib/schedule";
import { addDays } from "@/lib/time";

vi.mock("@/lib/auth", { spy: true });
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (path: string) => { throw new Error(`Redirect to ${path}`); } }));
process.env.DATABASE_PATH = ":memory:";

const db = getDb();
const semester = currentSemester()!;
let student: User;
const ids = {} as Record<"math" | "lab" | "physics" | "lecture" | "seminar" | "slotA" | "slotB" | "physicsLecture" | "physicsLab" | "own" | "other", number>;

const account = () => db.select().from(users).where(eq(users.id, student.id)).get()!;
const week = () => studentWeek(account(), semester).map((e) => e.entryId);
const redirectTo = (path: string) => new Error(`Redirect to ${path}`);

beforeAll(() => {
  const faculty = db.insert(faculties).values({ slug: "eng", name: "Engineering" }).returning().get();
  const spec = db.insert(specializations).values({ name: "Software", slug: "sw", code: "SW", degree: "bachelor", facultyId: faculty.id }).returning().get();
  ids.own = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "1.1" }).returning().get().id;
  ids.other = db.insert(groups).values({ specializationId: spec.id, year: 2, name: "2.1" }).returning().get().id;
  const course = (key: string, name: string, abbreviation: string) =>
    db.insert(courses).values({ key, name, abbreviation, facultyId: faculty.id, semesterId: semester.id }).returning().get().id;
  const entry = (key: string, courseId: number, kind: "course" | "seminar" | "lab", day: number, startMin: number, groupId: number, isSlotOption = false) => {
    const id = db.insert(entries).values({ key, courseId, kind, day, startMin, endMin: startMin + 120, semesterId: semester.id, rawText: key, isSlotOption })
      .returning().get().id;
    db.insert(entryGroups).values({ entryId: id, groupId }).run();
    return id;
  };
  ids.math = course("math", "Mathematics", "MATH");
  ids.lab = course("prog", "Programming", "PROG");
  ids.physics = course("physics", "Fizică", "FIZ");
  ids.lecture = entry("math-lecture", ids.math, "course", 1, 480, ids.own);
  ids.seminar = entry("math-seminar", ids.math, "seminar", 3, 600, ids.own);
  ids.slotA = entry("prog-lab-a", ids.lab, "lab", 2, 600, ids.own, true);
  ids.slotB = entry("prog-lab-b", ids.lab, "lab", 4, 600, ids.own, true);
  ids.physicsLecture = entry("physics-lecture", ids.physics, "course", 5, 480, ids.other);
  ids.physicsLab = entry("physics-lab", ids.physics, "lab", 5, 600, ids.other);
  student = db.insert(users).values({
    id: "student", name: "Student", email: "s@example.com", passwordHash: "unused", feedToken: "s",
    facultyId: faculty.id, specializationId: spec.id, year: 1, groupId: ids.own, onboardedAt: "2026-11-21T12:00:00Z",
  }).returning().get();
  vi.mocked(requireOnboardedUser).mockImplementation(async () => account());
});

/** The review form as the page renders it, with every course and session ticked. */
function reviewForm(changes: Record<string, string | null> = {}) {
  const form = new FormData();
  for (const c of timetableReview(account(), semester)) {
    form.set(`course-${c.courseId}`, "1");
    if (c.enrolled) form.set(`enrolled-${c.courseId}`, "on");
    if (c.chosenSlotId) form.set(`slot-${c.courseId}`, String(c.chosenSlotId));
    for (const a of c.activities) {
      form.set(`entry-${a.entryId}`, "1");
      if (!a.hidden) form.set(`keep-${a.entryId}`, "on");
    }
  }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) form.delete(key);
    else form.set(key, value);
  }
  return form;
}

describe("checking the timetable", () => {
  it("lists every course with its sessions and lab times, required courses included", () => {
    const review = timetableReview(account(), semester);
    expect(review.map((c) => c.name)).toEqual(["Mathematics", "Programming"]);
    const [math, prog] = review;
    expect(math).toMatchObject({ enrolled: true, isOptional: false, extraGroup: null });
    expect(math.activities.map((a) => [a.kind, a.hidden])).toEqual([["course", false], ["seminar", false]]);
    expect(prog.activities).toEqual([]);
    expect(prog.slots.map((s) => s.entryId)).toEqual([ids.slotA, ids.slotB]);
  });

  it("drops a single session, picks a lab time and confirms the timetable", async () => {
    await expect(saveTimetableAction(reviewForm({ [`keep-${ids.seminar}`]: null, [`slot-${ids.lab}`]: String(ids.slotB), confirm: "1" })))
      .rejects.toThrow(redirectTo("/timetable-settings?saved=confirmed#courses"));
    expect(week()).toEqual([ids.lecture, ids.slotB]);
    expect(account().timetableConfirmedAt).not.toBeNull();
    const math = timetableReview(account(), semester)[0];
    expect(math.activities.find((a) => a.entryId === ids.seminar)?.hidden).toBe(true);

    // Ticking it again brings it back.
    await expect(saveTimetableAction(reviewForm({ [`keep-${ids.seminar}`]: "on", confirm: "0" })))
      .rejects.toThrow(redirectTo("/timetable-settings?saved=1#courses"));
    expect(week()).toEqual([ids.lecture, ids.seminar, ids.slotB]);
  });

  it("lets the student untick a required course and keeps the session ticks for later", async () => {
    await saveTimetableAction(reviewForm({ [`keep-${ids.seminar}`]: null })).catch(() => {});
    await saveTimetableAction(reviewForm({ [`enrolled-${ids.math}`]: null })).catch(() => {});
    expect(week()).toEqual([ids.slotB]);
    await saveTimetableAction(reviewForm({ [`enrolled-${ids.math}`]: "on" })).catch(() => {});
    expect(week()).toEqual([ids.lecture, ids.slotB]);
    await saveTimetableAction(reviewForm({ [`keep-${ids.seminar}`]: "on" })).catch(() => {});
    expect(week()).toContain(ids.seminar);
  });

  it("leaves sessions that were not on the submitted form alone", async () => {
    const form = reviewForm();
    const added = db.insert(entries).values({ key: "math-lab", courseId: ids.math, kind: "lab", day: 2, startMin: 900, endMin: 1020, semesterId: semester.id, rawText: "lab" })
      .returning().get().id;
    db.insert(entryGroups).values({ entryId: added, groupId: ids.own }).run();
    await saveTimetableAction(form).catch(() => {});
    expect(week()).toContain(added);
    expect(db.select().from(userOverrides).where(eq(userOverrides.entryId, added)).get()).toBeUndefined();
  });

  it("remembers the lab time when a course is unticked and lets the student restore a hidden lab", async () => {
    const enrolled = `enrolled-${ids.lab}`;
    const slot = `slot-${ids.lab}`;
    const save = (changes: Record<string, string | null>) => expect(saveTimetableAction(reviewForm(changes)))
      .rejects.toThrow(redirectTo("/timetable-settings?saved=1#courses"));
    await save({ [slot]: String(ids.slotA) });
    await save({ [enrolled]: null, [slot]: null });
    expect(week()).not.toContain(ids.slotA);
    await save({ [enrolled]: "on", [slot]: null });
    expect(week()).toContain(ids.slotA);

    db.insert(userOverrides).values({ userId: student.id, entryId: ids.slotA, hidden: true }).run();
    await save({ [slot]: "" });
    const lab = timetableReview(account(), semester).find((c) => c.courseId === ids.lab)!;
    expect(lab.hiddenSlotIds).toEqual([ids.slotA]);
    expect(week()).not.toContain(ids.slotA);
    await save({ [slot]: String(ids.slotA) });
    expect(week()).toContain(ids.slotA);
  });

  it("gives the assistant and the settings page the same first-year course and lab choices", () => {
    const ctx = { user: account(), location: null, changed: false };
    const choices = runTool("list_course_choices", {}, ctx);
    expect(choices).toMatchObject({ courses: expect.arrayContaining([
      expect.objectContaining({ course: "Mathematics", optional: false, can_be_dropped: true }),
    ]) });
    expect(runTool("set_course_choice", { course: "math", following: false }, ctx)).toMatchObject({ following: false });
    expect(timetableReview(account(), semester).find((c) => c.courseId === ids.math)?.enrolled).toBe(false);
    runTool("set_course_choice", { course: "math", following: true }, ctx);
    db.insert(userOverrides).values({ userId: student.id, entryId: ids.slotB, hidden: true }).run();
    expect(runTool("set_course_choice", { course: "prog", slot: 2 }, ctx)).toMatchObject({ following: true });
    expect(week()).toContain(ids.slotB);
  });
});

describe("extra courses", () => {
  it("finds courses taught to other groups, without diacritics, and not the student's own", () => {
    const found = extraCourseOptions(account(), semester, "fizica");
    expect(found.map((c) => c.name)).toEqual(["Fizică"]);
    expect(found[0].groups).toEqual([expect.objectContaining({ groupId: ids.other, specialization: "SW", year: 2, label: "2.1" })]);
    expect(found[0].groups[0].sessions.map((s) => s.kind)).toEqual(["course", "lab"]);
    expect(extraCourseOptions(account(), semester, "math")).toEqual([]);
    expect(extraCourseOptions(account(), semester, "f")).toEqual([]);
  });

  it("adds the other group's sessions to the timetable and removes them again", async () => {
    expect(studentOwnsEntry(account(), ids.physicsLab)).toBe(false);
    const form = new FormData();
    form.set("courseId", String(ids.physics));
    form.set("groupId", String(ids.other));
    await expect(addExtraCourseAction(form)).rejects.toThrow(redirectTo(`/timetable-settings?extra=added#course-${ids.physics}`));
    expect(week()).toEqual(expect.arrayContaining([ids.physicsLecture, ids.physicsLab]));
    expect(studentOwnsEntry(account(), ids.physicsLab)).toBe(true);
    const physics = timetableReview(account(), semester).find((c) => c.courseId === ids.physics)!;
    expect(physics).toMatchObject({ enrolled: true, extraGroup: { groupId: ids.other, label: "2.1", year: 2 } });
    expect(extraCourseOptions(account(), semester, "fiz")).toEqual([]);

    // An additional lab in the other group's timetable leaves its regular lab in place.
    const supplementary = db.insert(entries).values({ key: "physics-extra-lab", courseId: ids.physics, kind: "lab",
      day: 3, startMin: 720, endMin: 840, semesterId: semester.id, rawText: "extra lab", isSlotOption: true }).returning().get();
    db.insert(entryGroups).values({ entryId: supplementary.id, groupId: ids.other }).run();
    const withExtraLab = timetableReview(account(), semester).find((c) => c.courseId === ids.physics)!;
    expect(withExtraLab.slotsAreExtra).toBe(true);
    expect(needsSlot(withExtraLab)).toBe(false);
    expect(week()).toContain(ids.physicsLab);
    expect(week()).not.toContain(supplementary.id);

    // Its sessions can be ticked off like any other.
    await saveTimetableAction(reviewForm({ [`keep-${ids.physicsLab}`]: null })).catch(() => {});
    expect(week()).toContain(ids.physicsLecture);
    expect(week()).not.toContain(ids.physicsLab);

    await expect(removeExtraCourseAction(ids.physics)).rejects.toThrow(redirectTo("/timetable-settings?extra=removed#courses"));
    expect(week()).not.toContain(ids.physicsLecture);
    expect(db.select().from(userExtraCourses).all()).toEqual([]);
    expect(db.select().from(userOverrides).where(eq(userOverrides.entryId, ids.physicsLab)).get()).toBeUndefined();
  });

  it("refuses a course the chosen group does not have, or one already in the timetable", async () => {
    const add = (courseId: number, groupId: number) => {
      const form = new FormData();
      form.set("courseId", String(courseId));
      form.set("groupId", String(groupId));
      return addExtraCourseAction(form);
    };
    await expect(add(ids.physics, ids.own)).rejects.toThrow(redirectTo("/timetable-settings?extra=unavailable#extra"));
    await expect(add(ids.math, ids.other)).rejects.toThrow(redirectTo("/timetable-settings?extra=unavailable#extra"));
    expect(db.select().from(userExtraCourses).all()).toEqual([]);
  });
});

describe("what contacts see of the private calendar", () => {
  it("shows personal event titles only when the student shares them, whatever the timetable setting", async () => {
    let monday = semester.weeks[1];
    for (const w of semester.weeks) if (!isPublicHoliday(w)) { monday = w; break; }
    db.insert(personalEvents).values({ userId: student.id, date: monday, startMin: 600, endMin: 660, title: "Dentist", location: "Clinic" }).run();
    const seen = () => contactEvents({ ...account(), id: student.id }, monday, addDays(monday, 0))
      .map((e) => [e.title, e.startMin, e.endMin]);

    expect(account().sharePrivateDetails).toBe(false);
    expect(seen()).toEqual([["Mathematics", 480, 600], ["Busy", 600, 660]]);

    const choose = async (value: string) => {
      const form = new FormData();
      form.set("private", value);
      await setPrivateSharing(form);
    };
    await choose("details");
    expect(account().sharePrivateDetails).toBe(true);
    expect(seen()).toEqual([["Mathematics", 480, 600], ["Dentist", 600, 660]]);

    // Classes kept private: they merge into one busy block, the shared personal event keeps its title.
    db.update(users).set({ shareActivityDetails: false }).where(eq(users.id, student.id)).run();
    expect(seen()).toEqual([["Busy", 480, 600], ["Dentist", 600, 660]]);

    await choose("unexpected");
    expect(account().sharePrivateDetails).toBe(true);
    await choose("busy");
    expect(seen()).toEqual([["Busy", 480, 660]]);
    db.update(users).set({ shareActivityDetails: true }).where(eq(users.id, student.id)).run();
  });
});
