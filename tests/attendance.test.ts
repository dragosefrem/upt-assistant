import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { attendance, courses, entries, entryGroups, examSpecializations, exams, faculties, groups, personalEvents, semesters, specializations, userOverrides, users } from "@/db/schema";
import { attendanceRecords, isMarkable, markAttendance, seriesDetails, summarizeAttendance, type AttendanceRecord } from "@/lib/attendance";
import type { User } from "@/lib/auth";
import { eventsBetween } from "@/lib/schedule";

// A private in-memory database with the real migrations and seed data.
process.env.DATABASE_PATH = ":memory:";

const TODAY = "2026-11-20"; // a Friday in teaching week 8 of semester 1, 2026–2027
const MON_PAST = "2026-11-16";
const MON_EARLIER = "2026-11-09";
const MON_FUTURE = "2026-11-23";

let user: User;
let semesterId: number;
let courseId: number;
let groupId: number;

function addEntry(key: string, kind: "course" | "lab", day: number, startMin: number, weeks = "all") {
  const db = getDb();
  const room = kind === "lab" ? "B12" : "A101";
  const teacher = kind === "lab" ? "As. Popescu" : "Prof. Ionescu";
  const row = db
    .insert(entries)
    .values({ key, semesterId, courseId, kind, day, startMin, endMin: startMin + 120, weeks, rawText: key, room, teacher })
    .returning()
    .get();
  db.insert(entryGroups).values({ entryId: row.id, groupId }).run();
  return row;
}

const classOn = (date: string, kind: "course" | "lab" = "course") =>
  eventsBetween(user, date, date).find((e) => e.type === "class" && e.kind === kind)!;

beforeAll(() => {
  const db = getDb();
  const semester = db.select().from(semesters).where(and(eq(semesters.academicYear, "2026-2027"), eq(semesters.number, 1))).get()!;
  semesterId = semester.id;
  db.update(semesters).set({ isCurrent: false }).run();
  db.update(semesters).set({ isCurrent: true }).where(eq(semesters.id, semesterId)).run();

  const faculty = db
    .insert(faculties)
    .values({ slug: "ac", name: "Automatică și Calculatoare", shortName: "AC", address: "Bd. Vasile Pârvan 2", lat: 45.7475, lng: 21.2262 })
    .returning()
    .get();
  const spec = db.insert(specializations).values({ facultyId: faculty.id, degree: "bachelor", name: "Calculatoare", slug: "calculatoare" }).returning().get();
  groupId = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "1.1" }).returning().get().id;
  courseId = db.insert(courses).values({ key: "ac-mate", semesterId, facultyId: faculty.id, name: "Matematică", abbreviation: "MATE", year: 1 }).returning().get().id;
  addEntry("ac-mate-curs", "course", 1, 8 * 60); // every Monday 08:00
  addEntry("ac-mate-lab", "lab", 1, 12 * 60, "even"); // Mondays of even weeks, 12:00

  user = db
    .insert(users)
    .values({ id: "u1", email: "student@example.com", name: "Student", passwordHash: "x", feedToken: "t", facultyId: faculty.id, specializationId: spec.id, year: 1, groupId })
    .returning()
    .get();

  const exam = db
    .insert(exams)
    .values({ key: "ac-exam-mate", facultyId: faculty.id, courseName: "Matematică", courseAbbr: "MATE", date: "2026-11-19", startMin: 540, endMin: 660, room: "A204", teacher: "Prof. Ionescu", audience: "C 1", year: 1, rawText: "x" })
    .returning()
    .get();
  db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec.id }).run();
});

describe("marking attendance", () => {
  it("marks one occurrence of a weekly class without touching the rest of the series", () => {
    const lecture = classOn(MON_PAST);
    expect(lecture.seriesKey).toBe("e:ac-mate-curs");
    expect(lecture.attendance).toBeNull();

    expect(markAttendance(user, { eventId: lecture.id, date: MON_PAST, status: "attended" }, TODAY)).toEqual({ ok: true, status: "attended" });

    expect(classOn(MON_PAST).attendance).toBe("attended");
    expect(classOn(MON_EARLIER).attendance).toBeNull();
    expect(classOn(MON_FUTURE).attendance).toBeNull();
    // The lab on the same day is a different series.
    expect(classOn(MON_PAST, "lab").attendance).toBeNull();
  });

  it("lets the student change their answer, keeping a single record", () => {
    const lecture = classOn(MON_EARLIER);
    markAttendance(user, { eventId: lecture.id, date: MON_EARLIER, status: "missed" }, TODAY);
    expect(classOn(MON_EARLIER).attendance).toBe("missed");

    markAttendance(user, { eventId: lecture.id, date: MON_EARLIER, status: "attended" }, TODAY);
    expect(classOn(MON_EARLIER).attendance).toBe("attended");
    expect(attendanceRecords(user.id).filter((r) => r.date === MON_EARLIER && r.seriesKey === "e:ac-mate-curs")).toHaveLength(1);
  });

  it("clears a mark back to 'not marked'", () => {
    const lab = classOn(MON_PAST, "lab");
    markAttendance(user, { eventId: lab.id, date: MON_PAST, status: "missed" }, TODAY);
    expect(classOn(MON_PAST, "lab").attendance).toBe("missed");

    expect(markAttendance(user, { eventId: lab.id, date: MON_PAST, status: null }, TODAY)).toEqual({ ok: true, status: null });
    expect(classOn(MON_PAST, "lab").attendance).toBeNull();
    expect(attendanceRecords(user.id).some((r) => r.seriesKey === "e:ac-mate-lab")).toBe(false);
  });

  it("refuses future occurrences and events that are not in the student's calendar", () => {
    expect(isMarkable(TODAY, TODAY)).toBe(true);
    expect(isMarkable(MON_FUTURE, TODAY)).toBe(false);

    const future = classOn(MON_FUTURE);
    expect(markAttendance(user, { eventId: future.id, date: MON_FUTURE, status: "attended" }, TODAY)).toMatchObject({ ok: false, status: 400 });
    expect(markAttendance(user, { eventId: "e:999999:2026-11-16", date: MON_PAST, status: "attended" }, TODAY)).toMatchObject({ ok: false, status: 404 });
    // The right event id with the wrong date does not match either.
    expect(markAttendance(user, { eventId: classOn(MON_PAST).id, date: MON_EARLIER, status: "attended" }, TODAY)).toMatchObject({ ok: false, status: 404 });
  });

  it("survives the scraper re-importing the timetable with new entry ids", () => {
    const db = getDb();
    const before = classOn(MON_PAST);
    expect(before.attendance).toBe("attended");

    db.delete(entries).where(eq(entries.key, "ac-mate-curs")).run();
    const reimported = addEntry("ac-mate-curs", "course", 1, 8 * 60);
    expect(reimported.id).not.toBe(before.entryId);

    const after = classOn(MON_PAST);
    expect(after.entryId).toBe(reimported.id);
    expect(after.attendance).toBe("attended");
  });

  it("works for one-off and weekly personal events", () => {
    const db = getDb();
    const once = db.insert(personalEvents).values({ userId: user.id, title: "Career fair", date: "2026-11-18", startMin: 600, endMin: 660 }).returning().get();
    const weekly = db.insert(personalEvents).values({ userId: user.id, title: "Study group", day: 3, startMin: 1080, endMin: 1140 }).returning().get();
    const personal = (date: string, id: number) => eventsBetween(user, date, date).find((e) => e.personalId === id)!;

    markAttendance(user, { eventId: personal("2026-11-18", once.id).id, date: "2026-11-18", status: "attended" }, TODAY);
    markAttendance(user, { eventId: personal("2026-11-18", weekly.id).id, date: "2026-11-18", status: "missed" }, TODAY);

    expect(personal("2026-11-18", once.id).attendance).toBe("attended");
    expect(personal("2026-11-18", weekly.id).attendance).toBe("missed");
    expect(personal("2026-11-11", weekly.id).attendance).toBeNull();
  });

  it("keeps a snapshot of the event so history stays readable", () => {
    const row = getDb().select().from(attendance).where(and(eq(attendance.seriesKey, "e:ac-mate-curs"), eq(attendance.date, MON_PAST))).get()!;
    expect(row).toMatchObject({ courseKey: "c:ac-mate", title: "Matematică", abbr: "MATE", kind: "course", startMin: 480, endMin: 600, room: "A101", teacher: "Prof. Ionescu", status: "attended" });
  });
});

describe("series details", () => {
  const detailsFor = (seriesKey: string) => {
    const { series } = summarizeAttendance(attendanceRecords(user.id));
    const s = series.find((x) => x.seriesKeys.includes(seriesKey))!;
    return seriesDetails(user, [s]).get(s.key)!;
  };

  it("shows a class's current timetable details", () => {
    expect(detailsFor("e:ac-mate-curs")).toEqual({
      source: "timetable",
      title: "Matematică",
      abbr: "MATE",
      kind: "course",
      weeks: "Every week",
      room: "A101",
      // Resolved by the seeded campus building rules, like in the event dialog.
      place: expect.objectContaining({ name: expect.stringContaining("Clădirea Electro"), address: expect.stringContaining("Vasile Pârvan") }),
      teacher: "Prof. Ionescu",
      note: null,
      examDates: [],
      audience: null,
    });
  });

  it("reflects the student's own changes", () => {
    const db = getDb();
    const entry = db.select().from(entries).where(eq(entries.key, "ac-mate-curs")).get()!;
    db.insert(userOverrides).values({ userId: user.id, entryId: entry.id, room: "C305", note: "with group 1.2" }).run();
    expect(detailsFor("e:ac-mate-curs")).toMatchObject({ room: "C305", note: "moved by you · with group 1.2" });
    db.delete(userOverrides).where(eq(userOverrides.entryId, entry.id)).run();
  });

  it("shows exam date, room and audience", () => {
    const exam = eventsBetween(user, "2026-11-19", "2026-11-19").find((e) => e.type === "exam")!;
    expect(exam.seriesKey).toBe("x:ac-exam-mate");
    markAttendance(user, { eventId: exam.id, date: exam.date, status: "attended" }, TODAY);
    expect(detailsFor("x:ac-exam-mate")).toMatchObject({
      source: "timetable",
      kind: "exam",
      examDates: ["2026-11-19"],
      room: "A204",
      audience: "C 1",
      teacher: "Prof. Ionescu",
      weeks: "Once",
    });
  });

  it("shows how often a personal event repeats and where", () => {
    const weekly = getDb().select().from(personalEvents).where(eq(personalEvents.title, "Study group")).get()!;
    const once = getDb().select().from(personalEvents).where(eq(personalEvents.title, "Career fair")).get()!;
    getDb().update(personalEvents).set({ location: "Library" }).where(eq(personalEvents.id, weekly.id)).run();
    expect(detailsFor(`p:${weekly.id}`)).toMatchObject({ kind: "personal", weeks: "Every week", room: "Library", place: null });
    expect(detailsFor(`p:${once.id}`)).toMatchObject({ kind: "personal", weeks: "Once" });
  });

  it("falls back to the saved room and teacher once a class leaves the timetable", () => {
    const lab = classOn(MON_PAST, "lab");
    markAttendance(user, { eventId: lab.id, date: MON_PAST, status: "missed" }, TODAY);
    expect(detailsFor("e:ac-mate-lab")).toMatchObject({ source: "timetable", weeks: "even weeks", room: "B12", teacher: "As. Popescu" });

    getDb().delete(entries).where(eq(entries.key, "ac-mate-lab")).run();
    expect(detailsFor("e:ac-mate-lab")).toMatchObject({
      source: "saved",
      title: "Matematică",
      abbr: "MATE",
      kind: "lab",
      room: "B12",
      teacher: "As. Popescu",
      note: expect.stringContaining("no longer in your calendar"),
    });
  });
});

describe("summarizeAttendance", () => {
  let id = 0;
  const rec = (
    courseKey: string,
    kind: string,
    date: string,
    status: "attended" | "missed",
    opts: { title?: string; startMin?: number; endMin?: number; seriesKey?: string } = {},
  ): AttendanceRecord => ({
    id: ++id,
    userId: "u",
    seriesKey: opts.seriesKey ?? `${courseKey}-${kind}`,
    occurrenceKey: date,
    courseKey,
    kind,
    date,
    status,
    title: opts.title ?? "Matematică",
    abbr: null,
    startMin: opts.startMin ?? 480,
    endMin: opts.endMin ?? 600,
    room: null,
    teacher: null,
    updatedAt: "",
  });
  // Mondays and Thursdays of the autumn semester.
  const mondays = ["2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23", "2026-11-30", "2026-12-07"];
  const thursdays = ["2026-10-08", "2026-10-15"];

  it("reports nothing-marked as an unknown rate rather than 0%", () => {
    expect(summarizeAttendance([])).toEqual({ attended: 0, missed: 0, rate: null, series: [] });
  });

  it("gives every series its own tally and no per-course total", () => {
    const records = [
      ...mondays.map((d, i) => rec("c:mate", "course", d, i < 8 ? "attended" : "missed")),
      rec("c:mate", "lab", thursdays[0], "attended", { startMin: 720, endMin: 840 }),
      rec("c:mate", "lab", thursdays[1], "missed", { startMin: 720, endMin: 840 }),
      rec("p:7", "personal", "2026-10-14", "attended", { title: "Study group", startMin: 1080, endMin: 1140 }),
      rec("x:ex1", "exam", "2027-01-26", "attended", { title: "Matematică", startMin: 540, endMin: 660 }),
    ];
    const s = summarizeAttendance(records);
    expect(s).toMatchObject({ attended: 11, missed: 3, rate: 79 });
    expect(s).not.toHaveProperty("courses");

    expect(s.series.map((x) => [x.title, x.kind, x.weekday, x.startMin, x.endMin, x.attended, x.missed, x.rate])).toEqual([
      ["Matematică", "course", 1, 480, 600, 8, 2, 80],
      ["Matematică", "lab", 4, 720, 840, 1, 1, 50],
      ["Matematică", "exam", 2, 540, 660, 1, 0, 100],
      ["Study group", "personal", 3, 1080, 1140, 1, 0, 100],
    ]);
  });

  it("lists each series' dates newest first with their status", () => {
    const s = summarizeAttendance([
      rec("c:mate", "lab", thursdays[0], "attended", { startMin: 720, endMin: 840 }),
      rec("c:mate", "lab", thursdays[1], "missed", { startMin: 720, endMin: 840 }),
    ]);
    expect(s.series[0].records.map((r) => [r.date, r.status])).toEqual([
      ["2026-10-15", "missed"],
      ["2026-10-08", "attended"],
    ]);
  });

  it("splits a course's type by weekday and time, and merges entries in the same slot", () => {
    const s = summarizeAttendance([
      rec("c:mate", "course", "2026-10-05", "attended"), // Monday 08:00
      rec("c:mate", "course", "2026-10-07", "attended"), // Wednesday 08:00
      rec("c:mate", "course", "2026-10-12", "missed", { startMin: 600, endMin: 720 }), // Monday 10:00
      // Odd- and even-week entries in the same Monday 08:00 slot are one series.
      rec("c:mate", "course", "2026-10-19", "missed", { seriesKey: "e:mate-even" }),
    ]);
    expect(s.series.map((x) => [x.weekday, x.startMin, x.attended, x.missed])).toEqual([
      [1, 480, 1, 1],
      [1, 600, 0, 1],
      [3, 480, 1, 0],
    ]);
  });

  it("names a series after its most recent mark", () => {
    const s = summarizeAttendance([
      rec("c:x", "course", "2026-10-05", "attended", { title: "Old name" }),
      rec("c:x", "course", "2026-10-12", "attended", { title: "New name" }),
    ]);
    expect(s.series).toHaveLength(1);
    expect(s.series[0].title).toBe("New name");
  });
});

describe("in Romanian", () => {
  const detailsRo = (seriesKey: string) => {
    const { series } = summarizeAttendance(attendanceRecords(user.id));
    const s = series.find((x) => x.seriesKeys.includes(seriesKey))!;
    return seriesDetails(user, [s], "ro").get(s.key)!;
  };

  it("explains a refused mark in the student's language", () => {
    expect(markAttendance(user, { eventId: classOn(MON_FUTURE).id, date: MON_FUTURE, status: "attended" }, TODAY, "ro")).toMatchObject({
      ok: false,
      status: 400,
      error: expect.stringContaining("nu a avut loc încă"),
    });
    expect(markAttendance(user, { eventId: "e:999999:2026-11-16", date: MON_PAST, status: "attended" }, TODAY, "ro")).toMatchObject({
      status: 404,
      error: "Evenimentul nu mai e în calendarul tău.",
    });
  });

  it("describes weeks and notes in Romanian", () => {
    expect(detailsRo("e:ac-mate-curs")).toMatchObject({ weeks: "În fiecare săptămână", note: null });
    expect(detailsRo("x:ac-exam-mate")).toMatchObject({ weeks: "O singură dată" });
    // The lab was removed from the timetable in an earlier test.
    expect(detailsRo("e:ac-mate-lab")).toMatchObject({ source: "saved", note: expect.stringContaining("nu mai e în calendarul tău") });
  });
});
