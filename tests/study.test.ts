import { placeByName, placeResolver } from "@/lib/schedule";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getDb } from "@/db";
import { seed } from "@/db/seed";
import { applyCatalog } from "@/scraper/apply";
import { contacts, courses, entries, entryGroups, exams, examSpecializations, faculties, groups, occurrenceOverrides, personalEvents, savedContacts, semesters, specializations, users } from "@/db/schema";
import { guide } from "@/i18n/messages/guide";
import { askLocal } from "@/lib/assistant/local";
import { runTool, type ToolContext } from "@/lib/assistant/tools";
import type { User } from "@/lib/auth";
import { contactWeek, currentContactStatuses } from "@/lib/contact-schedule";
import { searchGlossary } from "@/lib/glossary";
import { exportItems, toICS } from "@/lib/export";
import { makeupSessions, nextOccurrence, practicalsInWeek, weekInfo } from "@/lib/labs";
import { availabilityAt, listPeople, matchPeople } from "@/lib/people";
import { currentSemester, eventsBetween, groupBusy } from "@/lib/schedule";
import { semesterOverview } from "@/lib/semester-overview";
import { buildStudyPlan, clearStudyPlan, proposeStudyPlan, saveStudyPlan, studyBlocks, type PlanExam } from "@/lib/study-plan";

type Any = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

describe("buildStudyPlan", () => {
  const exam = (key: string, date: string, startMin = 9 * 60): PlanExam => ({ key, course: key.toUpperCase(), date, startMin, endMin: startMin + 120 });
  const base = { today: "2027-01-18", nowMinutes: 8 * 60 };

  it("keeps a later sitting free while planning for the next course", () => {
    const first = { ...exam("am", "2027-01-27"), alsoOn: ["2027-02-10"] };
    const plan = buildStudyPlan([first, exam("fiz", "2027-02-11")], [], base);
    expect(plan.sessions).toHaveLength(12);
    expect(plan.sessions.some((block) => block.date === "2027-02-10")).toBe(false);
  });

  it("works backwards from the exam: the days right before it, never the exam day", () => {
    // Wednesday 27 January; six blocks at two a day take the three days before it, skipping Sunday.
    const plan = buildStudyPlan([exam("am", "2027-01-27")], [], base);
    expect(plan.short).toEqual([]);
    expect(plan.sessions).toHaveLength(6);
    expect([...new Set(plan.sessions.map((s) => s.date))]).toEqual(["2027-01-23", "2027-01-25", "2027-01-26"]);
    expect(plan.sessions.every((s) => s.date < "2027-01-27")).toBe(true);
    // One block before lunch and one after, never back to back.
    const day = plan.sessions.filter((s) => s.date === "2027-01-26");
    expect(day.map((s) => hm(s.startMin))).toEqual(["10:00", "13:30"]);
    expect(plan.sessions.at(-1)).toMatchObject({ review: true, index: 6, total: 6 });
    expect(plan.sessions.filter((s) => s.review)).toHaveLength(1);
  });

  it("gives the days between two exams to the later one and pushes the earlier one further back", () => {
    const plan = buildStudyPlan([exam("am", "2027-01-27"), exam("fiz", "2027-01-29")], [], base);
    const days = (key: string) => [...new Set(plan.sessions.filter((s) => s.examKey === key).map((s) => s.date))];
    // Thursday 28 belongs to Physics; it still needs four more blocks, which come before the first exam.
    expect(days("fiz")).toEqual(["2027-01-25", "2027-01-26", "2027-01-28"]);
    expect(days("am")).toEqual(["2027-01-21", "2027-01-22", "2027-01-23"]);
    expect(plan.sessions.some((s) => s.date === "2027-01-27")).toBe(false);
    // No day carries more than two blocks.
    const perDay = new Map<string, number>();
    for (const s of plan.sessions) perDay.set(s.date, (perDay.get(s.date) ?? 0) + 1);
    expect(Math.max(...perDay.values())).toBe(2);
  });

  it("fits blocks around what is already in the calendar", () => {
    const busy = [{ date: "2027-01-26", startMin: 10 * 60, endMin: 16 * 60 }];
    const plan = buildStudyPlan([exam("am", "2027-01-27")], busy, { ...base, sessionsPerExam: 2 });
    expect(plan.sessions.map((s) => `${s.date} ${hm(s.startMin)}`)).toEqual(["2027-01-25 10:00", "2027-01-26 16:00"]);
  });

  it("reports an exam that cannot get all its blocks, and never plans in the past", () => {
    const plan = buildStudyPlan([exam("am", "2027-01-20")], [], { ...base, nowMinutes: 15 * 60 });
    // Monday from 15:30 (one block), Tuesday (two): three of six.
    expect(plan.sessions.map((s) => `${s.date} ${hm(s.startMin)}`)).toEqual(["2027-01-18 15:30", "2027-01-19 10:00", "2027-01-19 13:30"]);
    expect(plan.short).toEqual([{ examKey: "am", course: "AM", planned: 3, wanted: 6 }]);
  });

  it("honours a later start, Sundays on request and the hours of the day", () => {
    const sunday = buildStudyPlan([exam("am", "2027-01-25")], [], { ...base, sessionsPerExam: 2, restWeekdays: [] });
    expect(sunday.sessions.every((s) => s.date === "2027-01-24")).toBe(true);
    const late = buildStudyPlan([exam("am", "2027-01-27")], [], { ...base, startFrom: "2027-01-26", dayStart: 16 * 60, dayEnd: 22 * 60 });
    expect(late.sessions.map((s) => `${s.date} ${hm(s.startMin)}`)).toEqual(["2027-01-26 16:00", "2027-01-26 19:30"]);
  });
});

describe("searchGlossary", () => {
  const find = (q: string, locale: "ro" | "en" = "ro") => searchGlossary(guide[locale].entries, q).map((e) => e.id);
  it("finds a word with or without diacritics, and by abbreviation", () => {
    expect(find("semigrupă")[0]).toBe("semigrupa");
    expect(find("semigrupa", "en")[0]).toBe("semigrupa");
    expect(find("subgrupa")[0]).toBe("semigrupa");
    expect(find("ș.l.")[0]).toBe("titluri");
    expect(find("restanta")[0]).toBe("restanta");
    expect(find("odd", "en")[0]).toBe("paritate");
  });
  it("returns everything for an empty query and nothing for nonsense", () => {
    expect(find("")).toHaveLength(guide.ro.entries.length);
    expect(find("zzzqqq")).toEqual([]);
  });
  it("keeps both languages in step", () => {
    expect(guide.ro.entries.map((e) => e.id)).toEqual(guide.en.entries.map((e) => e.id));
    expect(guide.ro.steps.map((s) => s.id)).toEqual(guide.en.steps.map((s) => s.id));
  });
});

describe("labs, make-up sessions, people and the study plan for a student", () => {
  let ana: User;
  let mihai: User;
  let ctx: ToolContext;
  const call = (name: string, input: Any = {}) => runTool(name, input, ctx) as Any;

  beforeAll(() => {
    // Monday 23 November 2026, 10:00 in Timișoara: teaching week 9 (odd) of semester 1.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-23T08:00:00Z"));
    process.env.DATABASE_PATH = ":memory:";
    const db = getDb();
    const semester = db.select().from(semesters).where(eq(semesters.isCurrent, true)).get()!;
    const faculty = db.insert(faculties).values({ slug: "ac2", name: "Automatică și Calculatoare", shortName: "AC" }).returning().get();
    const spec = db.insert(specializations).values({ facultyId: faculty.id, degree: "bachelor", name: "Calculatoare și tehnologia informației", slug: "cti", code: "CTI" }).returning().get();
    const group = (name: string) => db.insert(groups).values({ specializationId: spec.id, year: 1, series: "Seria 1", name }).returning().get();
    const g11 = group("1.1");
    const g12 = group("1.2");
    const g21 = group("2.1");
    const course = (key: string, name: string, abbr: string) => db.insert(courses).values({ key, semesterId: semester.id, facultyId: faculty.id, name, abbreviation: abbr, year: 1 }).returning().get();
    const fiz = course("t-fiz", "Fizică", "FIZ");
    const pc = course("t-pc", "Programarea calculatoarelor", "PC");
    const am = course("t-am", "Analiză matematică", "AM");
    let n = 0;
    const entry = (c: { id: number }, kind: "course" | "lab" | "seminar", day: number, start: number, weeks: string, who: Array<{ id: number }>, room = "B418") => {
      const e = db
        .insert(entries)
        .values({ key: `t-e${++n}`, semesterId: semester.id, courseId: c.id, kind, day, startMin: start * 60, endMin: (start + 2) * 60, weeks, room, rawText: "" })
        .returning()
        .get();
      for (const g of who) db.insert(entryGroups).values({ entryId: e.id, groupId: g.id }).run();
      return e;
    };
    entry(am, "course", 1, 8, "all", [g11, g12, g21], "D1");
    entry(am, "seminar", 2, 12, "all", [g11, g12], "A115");
    entry(pc, "lab", 4, 10, "all", [g11]); // Ana: Thursday 10–12, every week
    entry(pc, "lab", 3, 10, "all", [g12]); // 1.2: Wednesday 10–12
    entry(pc, "lab", 2, 12, "all", [g21]); // 2.1: Tuesday 12–14, clashes with Ana's seminar
    entry(fiz, "lab", 3, 14, "even", [g11]); // Ana: Wednesday 14–16, even weeks only
    entry(fiz, "lab", 3, 14, "odd", [g12]); // 1.2: the other parity
    entry(fiz, "lab", 5, 8, "odd", [g21]);

    const person = (id: string, name: string, g: { id: number }) =>
      db
        .insert(users)
        .values({ id, email: `${id}@example.com`, name, passwordHash: "x", feedToken: id, facultyId: faculty.id, specializationId: spec.id, year: 1, groupId: g.id, onboardedAt: "2026-10-01" })
        .returning()
        .get();
    ana = person("s-ana", "Ana Popescu", g11);
    mihai = person("s-mihai", "Mihai Ionescu", g12);
    db.insert(contacts).values({ firstId: ana.id, secondId: mihai.id, requestedBy: ana.id, accepted: true }).run();
    db.insert(savedContacts).values({ userId: ana.id, name: "Radu", nameKey: "radu", groupId: g21.id }).run();
    // Mihai has a dentist appointment that Ana must only see as busy time.
    db.insert(personalEvents).values({ userId: mihai.id, title: "Dentist", date: "2026-11-26", day: null, startMin: 16 * 60, endMin: 17 * 60 }).run();

    const x = (key: string, name: string, date: string) => {
      const row = db
        .insert(exams)
        .values({ key, facultyId: faculty.id, courseName: name, date, startMin: 9 * 60, endMin: 11 * 60, room: "A101", year: 1, rawText: "" })
        .returning()
        .get();
      db.insert(examSpecializations).values({ examId: row.id, specializationId: spec.id }).run();
    };
    x("t-x-am", "Analiză matematică", "2027-01-27");
    x("t-x-fiz", "Fizică", "2027-02-03");
    ctx = { user: ana, location: null, changed: false, locale: "ro" };
  });

  it("knows the week's number and parity, and when teaching pauses", () => {
    const semester = currentSemester()!;
    expect(weekInfo("2026-11-23", semester)).toMatchObject({ week: 9, parity: "odd", pause: null });
    expect(weekInfo("2026-12-28", semester)).toMatchObject({ week: null, pause: "holiday", resumes: "2027-01-11" });
    expect(weekInfo("2027-02-01", semester)).toMatchObject({ week: null, pause: "session" });
    expect(semesterOverview(semester, "2026-11-23")).toMatchObject({ week: 9, parity: "odd", state: "teaching", weeksLeft: 5, totalWeeks: 14 });
    expect(semesterOverview(semester, "2026-11-23").holidays).toEqual([{ from: "2026-12-21", to: "2027-01-10" }]);
  });

  it("says which labs take place this week and when a skipped one comes next", () => {
    const week = practicalsInWeek(ana, "2026-11-23");
    expect(week.running.map((e) => `${e.title} ${e.kind} ${e.date}`)).toEqual(["Analiză matematică seminar 2026-11-24", "Programarea calculatoarelor lab 2026-11-26"]);
    // Week 9 is odd, so the even-week physics lab is skipped; it comes back on Wednesday of week 10.
    expect(week.skipped).toHaveLength(1);
    expect(week.skipped[0]).toMatchObject({ title: "Fizică", weeks: "even", next: "2026-12-02" });
    const even = practicalsInWeek(ana, "2026-12-01", ["lab"]);
    expect(even.running.map((e) => e.title)).toEqual(["Fizică", "Programarea calculatoarelor"]);
    expect(even.skipped).toEqual([]);
    // In the winter holiday nothing runs and everything resumes afterwards.
    const holiday = practicalsInWeek(ana, "2026-12-28", ["lab"]);
    expect(holiday.pause).toBe("holiday");
    expect(holiday.running).toEqual([]);
    expect(holiday.skipped.map((e) => e.next)).toEqual(["2027-01-20", "2027-01-14"]);
  });

  it("finds the next date of an every-other-week class", () => {
    const semester = currentSemester()!;
    expect(nextOccurrence({ day: 3, weeks: "even" }, semester, "2026-11-23")).toBe("2026-12-02");
    expect(nextOccurrence({ day: 3, weeks: "odd" }, semester, "2026-11-23")).toBe("2026-11-25");
    expect(nextOccurrence({ day: 3, weeks: "1-7" }, semester, "2026-11-23")).toBeNull();
  });

  it("answers the lab question through the assistant tool", () => {
    const r = call("labs_this_week", { kinds: ["lab"] });
    expect(r).toMatchObject({ teaching_week: 9, parity: "odd" });
    expect(r.takes_place.map((e: Any) => e.title)).toEqual(["Programarea calculatoarelor"]);
    expect(r.not_this_week).toEqual([{ course: "Fizică", kind: "lab", usually: "Wednesday 14:00–16:00", runs: "even weeks", next_on: "Wednesday 2026-12-02" }]);
    expect(call("labs_this_week", { course: "fizica", date: "2026-12-01" }).takes_place).toHaveLength(1);
  });

  it("lists other groups' sessions of a missed lab, the ones that fit first", () => {
    const found = makeupSessions(ana, { course: "PC", from: "2026-11-23", to: "2026-11-29" });
    expect(found.ok).toBe(true);
    if (!found.ok) return;
    expect(found.result).toMatchObject({ course: "Programarea calculatoarelor", kind: "lab" });
    expect(found.result.own.map((o) => o.date)).toEqual(["2026-11-26"]);
    // Wednesday with 1.2 fits; Tuesday with 2.1 overlaps Ana's seminar, so it comes second.
    expect(found.result.sessions.map((s) => [s.date, s.groups[0], s.clashes.length])).toEqual([
      ["2026-11-25", "CTI · Seria 1 · 1.2", 0],
      ["2026-11-24", "CTI · Seria 1 · 2.1", 1],
    ]);
    // The physics lab alternates: this odd week the other two groups have it.
    const fiz = makeupSessions(ana, { course: "Fizică", from: "2026-11-23", to: "2026-11-29" });
    expect(fiz.ok && fiz.result.sessions.map((s) => s.date)).toEqual(["2026-11-25", "2026-11-27"]);
    expect(makeupSessions(ana, { course: "Chimie", from: "2026-11-23", to: "2026-11-29" })).toEqual({ ok: false, reason: "not-found" });

    const tool = call("find_makeup_lab", { course: "pc" });
    expect(tool.activity).toBe("Programarea calculatoarelor (lab)");
    expect(tool.other_groups[0]).toMatchObject({ date: "2026-11-25", fits_timetable: true });
    expect(tool.note).toMatch(/teacher/);
  });

  it("treats linked accounts and saved people differently when checking who is free", () => {
    const people = listPeople(ana.id);
    expect(people.map((p) => `${p.kind}:${p.name}`)).toEqual(["account:Mihai Ionescu", "saved:Radu"]);
    expect(matchPeople(people, "mihai").map((p) => p.name)).toEqual(["Mihai Ionescu"]);
    expect(matchPeople(people, "ionescu")).toHaveLength(1);
    expect(matchPeople(people, "xyz")).toEqual([]);

    // Thursday 16:00: Mihai is at the dentist (private), Radu's group has nothing.
    const thursday = availabilityAt(people, "2026-11-26", 16 * 60, 17 * 60);
    expect(thursday.map((a) => [a.person.name, a.free, a.busy.map((b) => b.what)])).toEqual([
      ["Mihai Ionescu", false, [null]],
      ["Radu", true, []],
    ]);
    // Wednesday 10:00: Mihai has his PC lab, which is named.
    expect(availabilityAt(people, "2026-11-25", 10 * 60, 11 * 60)[0]).toMatchObject({ free: false, busy: [{ what: "Programarea calculatoarelor" }] });
  });

  it("shares the current lab within its time slot and applies the owner's preference to every contact view", () => {
    const date = "2026-11-25";
    const status = (minutes: number) => currentContactStatuses(ana.id, "en", { date, minutes }).get(mihai.id);
    const lab = { state: "activity", kind: "lab", title: "Programarea calculatoarelor", room: "B418" };
    expect(status(599)).toEqual({ state: "free" });
    expect(status(600)).toEqual(lab);
    expect(status(719)).toEqual(lab);
    expect(status(720)).toEqual({ state: "free" });

    const share = (enabled: boolean) =>
      getDb().update(users).set({ shareActivityDetails: enabled }).where(eq(users.id, mihai.id)).run();
    share(false);
    try {
      expect(status(600)).toEqual({ state: "busy" });
      expect(status(720)).toEqual({ state: "free" });
      const week = contactWeek(ana.id, mihai.id, date, "ro")!;
      expect(week.events.length).toBeGreaterThan(0);
      expect(week.events.every((e) => e.kind === "busy" && e.title === "Ocupat" && e.room === null)).toBe(true);
      const nextDay = { date: "2026-11-26", minutes: 600 };
      expect(currentContactStatuses(mihai.id, "en", nextDay).get(ana.id)).toEqual(lab);
      expect(call("who_is_free", { date, start: "10:00", people: ["Mihai"] }).busy[0].busy_with).toEqual(["busy 10:00–12:00"]);
      const schedule = call("contact_schedule", { from: date, person: "Mihai" });
      expect(schedule.busy.map((e: Any) => e.what)).toEqual(["busy", "busy"]);
    } finally {
      share(true);
    }
    expect(status(600)).toEqual(lab);
  });

  it("answers \"who is free?\" through the assistant, for everyone or for the people named", () => {
    const all = call("who_is_free", { date: "2026-11-26", start: "16:00", end: "17:00" });
    expect(all.you).toEqual({ free: true });
    expect(all.free.map((p: Any) => p.name)).toEqual(["Radu"]);
    expect(all.busy).toHaveLength(1);
    expect(all.busy[0]).toMatchObject({ name: "Mihai Ionescu", busy_with: ["busy 16:00–17:00"] });
    expect(all.everyone_free).toBe(false);
    expect(all.caveat).toMatch(/published timetable/);

    const named = call("who_is_free", { date: "2026-11-27", start: "12:00", people: ["Mihai", "Radu", "Bogdan"] });
    expect(named.free.map((p: Any) => p.name)).toEqual(["Mihai Ionescu", "Radu"]);
    expect(named.not_a_contact).toEqual(["Bogdan"]);
    expect(named.everyone_free).toBe(false);

    // On teaching Mondays Ana has the lecture; Saint Andrew’s Day is free.
    expect(call("who_is_free", { date: "2026-11-23", start: "08:00", people: ["Radu"] }).you.free).toBe(false);
    expect(call("who_is_free", { date: "2026-11-30", start: "08:00", people: ["Radu"] }).everyone_free).toBe(true);
    expect(call("who_is_free", { date: "2026-11-27", start: "12:00", people: ["Bogdan"] }).error).toMatch(/Bogdan/);
  });

  it("plans meetings around a linked account's real calendar", () => {
    // Thursday afternoon: Ana is free from 12:00; Mihai's dentist takes 16:00–17:00.
    const r = call("find_meeting_slots", { with: ["Mihai"], from: "2026-11-26", to: "2026-11-26", earliest: "15:00", latest: "19:00", count: 4 });
    expect(r.for).toBe("you and Mihai Ionescu");
    expect(r.slots.map((s: Any) => s.start)).toEqual(["15:00", "17:00", "18:00"]);
    expect(r.caveat).toBeUndefined();
  });

  it("proposes a study plan, saves it in the student's language and can clear it", () => {
    const proposal = call("plan_exam_study");
    expect(proposal.proposal.map((p: Any) => [p.course, p.hours])).toEqual([
      ["Analiză matematică", 12],
      ["Fizică", 12],
    ]);
    expect(proposal.total_blocks).toBe(12);
    expect(ctx.changed).toBe(false);
    expect(studyBlocks(ana.id)).toHaveLength(0);

    const saved = call("plan_exam_study", { confirmed: true });
    expect(saved.saved_blocks).toBe(12);
    expect(ctx.changed).toBe(true);
    const blocks = studyBlocks(ana.id).sort((a, b) => (a.date! + a.startMin).localeCompare(b.date! + b.startMin));
    expect(blocks[0].title).toBe("Învăț: Analiză matematică (1/6)");
    expect(blocks.filter((b) => b.title.startsWith("Recapitulare"))).toHaveLength(2);
    expect(blocks.every((b) => b.plan?.startsWith("study:"))).toBe(true);

    // Planning again replaces the blocks instead of piling up, and treats the old ones as free time.
    const again = proposeStudyPlan(ana, { hoursPerExam: 4 });
    expect(again.sessions).toHaveLength(4);
    expect(saveStudyPlan(ana.id, again.sessions, "en")).toBe(4);
    expect(studyBlocks(ana.id).map((b) => b.title)).toContain("Final review: Fizică");
    expect(call("clear_study_plan").removed_blocks).toBe(4);
    expect(clearStudyPlan(ana.id)).toBe(0);
  });

  it("prepares for the first sitting when an exam is published twice", () => {
    const db = getDb();
    const spec = db.select().from(specializations).where(eq(specializations.slug, "cti")).get()!;
    const second = db
      .insert(exams)
      .values({ key: "t-x-am-2", facultyId: spec.facultyId, courseName: "Analiză matematică", date: "2027-02-10", startMin: 9 * 60, endMin: 11 * 60, room: "A101", year: 1, rawText: "" })
      .returning()
      .get();
    db.insert(examSpecializations).values({ examId: second.id, specializationId: spec.id }).run();
    const plan = proposeStudyPlan(ana);
    expect(plan.exams.map((x) => [x.course, x.date, x.alsoOn])).toEqual([
      ["Analiză matematică", "2027-01-27", ["2027-02-10"]],
      ["Fizică", "2027-02-03", []],
    ]);
    expect(plan.sessions).toHaveLength(12);
    db.delete(exams).where(eq(exams.id, second.id)).run();
  });

  it("plans from exams the student names when none are published", () => {
    const r = runTool("plan_exam_study", { extra_exams: [{ course: "Algebră", date: "2027-02-10", start: "12:00" }] }, { user: mihai, location: null, changed: false }) as Any;
    expect(r.proposal.map((p: Any) => p.course)).toEqual(["Analiză matematică", "Fizică", "Algebră"]);
    expect(r.proposal[2].exam).toBe("Wednesday 2027-02-10 12:00");
  });

  it("marks attendance and adds it up", () => {
    // Monday 23 November: the lecture at 08:00 has taken place.
    const marked = call("mark_attendance", { date: "2026-11-23", course: "AM", status: "attended" });
    expect(marked.events).toEqual(["Analiză matematică (course) 08:00–10:00"]);
    expect(call("mark_attendance", { date: "2026-11-26", course: "PC", status: "missed" }).error).toBeDefined(); // still in the future
    expect(call("mark_attendance", { date: "2026-11-19", course: "PC", status: "missed" }).status).toBe("missed");
    const summary = call("get_attendance");
    expect(summary).toMatchObject({ marked: 2, attended: 1, missed: 1, attendance_rate_percent: 50 });
    expect(call("get_attendance", { course: "PC" }).by_activity[0]).toMatchObject({ missed: 1, missed_on: ["2026-11-19"] });
  });

  it("can set a goal on an unmarked seminar and read how many more sessions are needed", () => {
    const activities = () => call("get_attendance", { course: "AM" }).semester_activities;
    const seminar = activities().find((a: Any) => a.kind === "seminar");
    expect(seminar).toMatchObject({ minimum: null, still_needed: null });
    const goal = { activity_id: seminar.activity_id, minimum: 5 };
    expect(call("set_attendance_goal", goal)).toEqual(goal);
    expect(activities().find((a: Any) => a.kind === "seminar")).toMatchObject({ attended: 0, minimum: 5, still_needed: 5 });
    expect(call("set_attendance_goal", { ...goal, minimum: 0 }).minimum).toBeNull();
    expect(activities().find((a: Any) => a.kind === "seminar").minimum).toBeNull();
  });

  it("answers the lab and glossary questions without an AI key, in the language asked", () => {
    const ro = askLocal("Am laborator săptămâna aceasta?", ctx);
    expect(ro).toContain("Săptămâna 9, impară.");
    expect(ro).toContain("Programarea calculatoarelor (lab) — joi, 26 noiembrie 10:00–12:00, B418");
    expect(ro).toContain("Fizică (lab) — nu săptămâna aceasta; următorul: 2026-12-02");
    const en = askLocal("Do I have lab next week?", ctx);
    expect(en).toContain("Teaching week 10, an even week.");
    expect(en).toContain("Fizică (lab) — Wednesday 2 December 14:00–16:00");
    expect(askLocal("Ce înseamnă semigrupă?", ctx)).toMatch(/^Semigrupă: Jumătate de grupă/);
    expect(askLocal("What does restanță mean?", ctx)).toMatch(/^Restanță: An exam you still have to pass/);
  });

  it("keeps contact availability, missed labs and study plans out of personal timetable lookups", () => {
    expect(askLocal("Which of my contacts are free tomorrow at 14:00?", ctx)).toContain("Plan a group event");
    expect(askLocal("Am lipsit de la un laborator. Ce alte grupe îl au săptămâna aceasta?", ctx)).toContain("recuperare");
    expect(askLocal("Make me a study plan for the exam session", ctx)).toContain("study planner");
  });

  it("withholds a faculty location for an unpublished or blank room", () => {
    const resolve = placeResolver(ana.facultyId);
    expect(resolve(null)).toBeNull();
    expect(resolve("  ")).toBeNull();
  });

  it("finds the building a calendar link names, and knows the faculty building is only a guess", () => {
    const db = getDb();
    expect(placeByName("Clădirea Electro (AC, ETcTI, IEE)", ana.facultyId)).toMatchObject({ address: "Bd. Vasile Pârvan 2, Timișoara", approximate: false });
    expect(placeByName("Clădirea SPM", ana.facultyId)).toMatchObject({ approximate: true });
    expect(placeByName("Clădirea SPM", ana.facultyId)?.guessed).toBeFalsy();
    expect(placeByName("Online", ana.facultyId)).toBeNull();
    expect(placeByName("A building nobody listed", ana.facultyId)).toBeNull();
    // The faculty has no coordinates in this fixture: nothing to lead to, so no place.
    expect(placeByName("Automatică și Calculatoare", ana.facultyId)).toBeNull();
    db.update(faculties).set({ lat: 45.7474, lng: 21.2262, address: "Bd. Vasile Pârvan 2" }).where(eq(faculties.id, ana.facultyId!)).run();
    try {
      expect(placeByName("Automatică și Calculatoare", ana.facultyId)).toMatchObject({ guessed: true, approximate: true, lat: 45.7474 });
      expect(placeResolver(ana.facultyId)("XYZ 1")).toMatchObject({ name: "Automatică și Calculatoare", guessed: true });
      expect(placeResolver(ana.facultyId)("SPM 204")?.guessed).toBeFalsy();
    } finally {
      db.update(faculties).set({ lat: null, lng: null, address: null }).where(eq(faculties.id, ana.facultyId!)).run();
    }
  });

  it("stores faculty names in one Unicode form, so a building is never listed twice", () => {
    const db = getDb();
    const typed = "Facultatea de Mecanică";
    const served = "Facultatea de Mecanica\u0306"; // "ă" as "a" + breve, as upt.ro serves it
    expect(served).not.toBe(typed);
    applyCatalog(db, { faculties: [{ slug: "mec-served", name: served, shortName: "MECS", website: null, scheduleUrl: null, address: null, lat: null, lng: null, specializations: [] }], warnings: [] });
    expect(db.select().from(faculties).where(eq(faculties.slug, "mec-served")).get()!.name).toBe(typed);
    // A database filled before this is repaired when it is opened.
    db.update(faculties).set({ name: served }).where(eq(faculties.slug, "mec-served")).run();
    seed(db);
    expect(db.select().from(faculties).where(eq(faculties.slug, "mec-served")).get()!.name).toBe(typed);
    db.delete(faculties).where(eq(faculties.slug, "mec-served")).run();
  });

  it("explains terms and opens pages", () => {
    const term = call("explain_term", { term: "semigrupă" });
    expect(term.entries[0].term).toBe("Semigrupă");
    expect(call("explain_term", { term: "qwertyzz" }).not_in_glossary).toBe("qwertyzz");
    expect(call("open_page", { page: "attendance" })).toMatchObject({ opening: "attendance" });
    expect(ctx.open).toBe("/attendance");
    expect(call("open_page", { page: "nowhere" }).error).toBeDefined();
    expect(call("set_language", { language: "en" }).interface_language).toBe("English");
    expect(ctx.setLocale).toBe("en");
    expect(getDb().select().from(users).where(eq(users.id, ana.id)).get()!.locale).toBe("en");
  });

  it("asks before creating a group event and invites only linked accounts", () => {
    const draft = call("create_group_event", { title: "Învățat la AM", date: "2026-11-27", start: "16:00", people: ["Mihai", "Radu"] });
    expect(draft.not_created_yet).toMatchObject({ inviting: ["Mihai Ionescu"], cannot_invite_directly: ["Radu"], guest_link: true, busy_then: [] });
    expect(call("list_group_events").events).toEqual([]);
    const created = call("create_group_event", { title: "Învățat la AM", date: "2026-11-27", start: "16:00", people: ["Mihai", "Radu"], confirmed: true });
    expect(created.page).toMatch(/^\/contacts\/events\//);
    expect(ctx.links?.at(-1)).toMatchObject({ label: "Învățat la AM" });
    expect(call("list_group_events").events[0]).toMatchObject({ title: "Învățat la AM", organised_by: "the student", your_answer: "accepted" });
    // Mihai sees the invitation and answers it.
    const his: ToolContext = { user: mihai, location: null, changed: false };
    expect((runTool("list_group_events", {}, his) as Any).waiting_for_your_answer).toEqual(["Învățat la AM"]);
    expect((runTool("respond_group_event", { event: "învățat", going: true }, his) as Any).your_answer).toBe("going");
    // A time when Mihai is busy is refused with a pointer to find another.
    const clash = call("create_group_event", { title: "Proiect", date: "2026-11-26", start: "16:00", people: ["Mihai"] });
    expect(clash.not_created_yet.busy_then).toEqual(["Mihai Ionescu"]);
  });

  it("skips only timetable classes on the November and December holidays, including in the .ics", () => {
    const start = "2026-11-30";
    const end = "2026-12-01";
    const db = getDb();
    db.insert(personalEvents).values({ userId: ana.id, title: "Family lunch", date: start, startMin: 720, endMin: 810 }).run();
    const exam = db.insert(exams).values({
      key: "holiday-exam", facultyId: ana.facultyId!, courseName: "Scheduled assessment", date: end,
      startMin: 540, endMin: 600, year: 1, rawText: "",
    }).returning().get();
    db.insert(examSpecializations).values({ examId: exam.id, specializationId: ana.specializationId! }).run();
    expect(eventsBetween(ana, start, end).map((e) => [e.type, e.title])).toEqual([["personal", "Family lunch"], ["exam", "Scheduled assessment"]]);
    expect(groupBusy(ana.groupId!, start, end)).toEqual([]);
    const holidays = [{ date: start, name: "Sfântul Andrei" }, { date: end, name: "Ziua Națională a României" }];
    expect(call("get_schedule", { from: start, to: end, language: "ro" }).holidays).toEqual(holidays);
    expect(call("labs_this_week", { date: start, language: "ro" }).holidays).toEqual(holidays);
    const week = practicalsInWeek(ana, start, undefined, "ro");
    expect(week.holidays).toEqual(holidays);
    expect(week.week).toBe(10);
    expect(week.running.map((e) => e.date)).toEqual(["2026-12-02", "2026-12-03"]);
    expect(week.skipped.find((e) => e.kind === "seminar")?.next).toBe("2026-12-08");
    const semester = currentSemester()!;
    expect(nextOccurrence({ day: 1, weeks: "all" }, semester, start)).toBe("2026-12-07");
    expect(nextOccurrence({ day: 2, weeks: end }, semester, start)).toBeNull();
    const makeups = makeupSessions(ana, { course: "PC", from: start, to: "2026-12-06" });
    expect(makeups.ok && makeups.result.sessions.map((e) => e.date)).toEqual(["2026-12-02"]);
    const file = toICS(exportItems(ana)).replace(/\r\n /g, "");
    expect(file).toMatch(/EXDATE;TZID=Europe\/Bucharest:[^\r\n]*20261130T080000/);
    expect(file).toMatch(/EXDATE;TZID=Europe\/Bucharest:[^\r\n]*20261201T120000/);
    expect(file).toContain("DTSTART;TZID=Europe/Bucharest:20261130T120000");
    expect(file).toContain("DTSTART;TZID=Europe/Bucharest:20261201T090000");
    expect(askLocal("Ce ore am pe 2026-12-01?", ctx)).toContain("Ziua Națională a României");
  });

  it("honours stored one-off moves whose original or destination date is a holiday", () => {
    const db = getDb();
    const seminar = eventsBetween(ana, "2026-11-24", "2026-11-24").find((e) => e.kind === "seminar")!;
    const entryId = seminar.entryId!;
    const change = { userId: ana.id, entryId, startMin: seminar.startMin, endMin: seminar.endMin };
    const moves = db.insert(occurrenceOverrides).values([
      { ...change, date: "2026-12-01", newDate: "2027-03-02" },
      { ...change, date: "2026-12-08", newDate: "2026-11-30" },
    ]).returning().all();
    try {
      expect(eventsBetween(ana, "2026-11-30", "2026-11-30").some((e) => e.entryId === entryId)).toBe(false);
      expect(eventsBetween(ana, "2027-03-02", "2027-03-02").find((e) => e.entryId === entryId)?.originalDate).toBe("2026-12-01");
      const exported = exportItems(ana).filter((e) => e.uid.startsWith(`entry-${entryId}-`));
      expect(exported.map((e) => e.date)).toEqual(["2027-03-02"]);
      expect(call("find_makeup_lab", { course: "AM", kind: "seminar", missed_on: "2027-03-01" })).toMatchObject({
        scheduled_on_missed_date: false, next_on: "2027-03-02",
      });
      expect(call("move_class_once", { course: "AM", kind: "seminar", date: "2026-11-24", to_date: "2026-12-01", confirmed: true }).error).toMatch(/public holiday/);
    } finally {
      for (const move of moves) db.delete(occurrenceOverrides).where(eq(occurrenceOverrides.id, move.id)).run();
    }
  });

  it("verifies a missed Tuesday against the chosen student's calendar, including individual moves", () => {
    const his: ToolContext = { user: mihai, location: null, changed: false };
    const run = (name: string, args: Any) => runTool(name, args, his) as Any;
    expect(run("move_class", { course: "FIZ", kind: "lab", to_weekday: 2, confirmed: true }).moved).toBeDefined();
    const missed = (date: string) => run("find_makeup_lab", { course: "FIZ", missed_on: date });
    expect(missed("2026-11-17")).toMatchObject({
      scheduled_on_missed_date: false, previous_on: "2026-11-10", next_on: "2026-11-24",
    });
    expect(missed("2026-11-17").other_groups).toBeUndefined();
    expect(missed("2026-11-24").scheduled_on_missed_date).toBe(true);
    expect(run("move_class_once", { course: "FIZ", date: "2026-11-24", to_date: "2026-11-25", confirmed: true }).moved).toBeDefined();
    expect(missed("2026-11-24")).toMatchObject({ scheduled_on_missed_date: false, previous_on: "2026-11-10", next_on: "2026-11-25" });
    expect(missed("2026-11-25").scheduled_on_missed_date).toBe(true);
    expect(missed("2026-11-31").error).toMatch(/real calendar date/);
    expect(run("restore_class", {}).needs_confirmation).toBeDefined();
    expect(missed("2026-11-25").scheduled_on_missed_date).toBe(true);
    expect(run("restore_class", { confirmed: true }).restored).toBe(2);
  });

  it("keeps changed study hours, morning starts and Saturday rest days in the saved plan", () => {
    const args = { hours_per_exam: 6, earliest: "08:00", blocks_per_day: 1, rest_weekdays: [6, 7] };
    const proposal = call("plan_exam_study", args);
    expect(proposal.proposal.every((p: Any) => p.hours === 6)).toBe(true);
    const blocks = proposal.proposal.flatMap((p: Any) => p.study_blocks);
    expect(blocks.join(" ")).not.toMatch(/Saturday|Sunday/);
    expect(blocks.every((s: string) => s.includes("08:00–10:00"))).toBe(true);
    expect(studyBlocks(ana.id)).toHaveLength(0);
    expect(call("plan_exam_study", { ...args, confirmed: true }).saved_blocks).toBe(blocks.length);
    expect(studyBlocks(ana.id).every((s) => s.startMin === 480)).toBe(true);
    expect(call("clear_study_plan").removed_blocks).toBe(blocks.length);
  });
});
