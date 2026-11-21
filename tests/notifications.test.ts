import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/notifications/route";
import { getDb } from "@/db";
import { courses, entries, entryGroups, eventParticipants, exams, examSpecializations, faculties, groupEvents, groups, occurrenceOverrides, personalEvents, semesters, specializations, userOverrides, users } from "@/db/schema";
import { messages } from "@/i18n/messages";
import { getLocale } from "@/i18n/server";
import { getUser, type User } from "@/lib/auth";
import { answerContact, inviteContact } from "@/lib/contacts";
import { exportItems, toICS } from "@/lib/export";
import { respondToEvent } from "@/lib/group-events";
import { alertKey, noticeCountdown, type ScheduledNotice } from "@/lib/notification-timing";
import type { NotificationFeed } from "@/lib/notifications";

vi.mock("@/lib/auth", async (load) => ({ ...(await load<typeof import("@/lib/auth")>()), getUser: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getLocale: vi.fn(), getT: () => messages.ro }));
vi.stubEnv("DATABASE_PATH", ":memory:");
vi.useFakeTimers({ toFake: ["Date"] });
const today = "2026-11-23";
const tomorrow = "2026-11-24";
const now = new Date("2026-11-23T07:45:00Z"); // Monday, 09:45 on campus.
const db = getDb();
let student: User;
const feed = async (): Promise<NotificationFeed> => (await GET()).json();

beforeEach(() => {
  vi.setSystemTime(now);
  db.delete(users).run();
  db.delete(faculties).run();
  const faculty = db.insert(faculties).values({ slug: "test", shortName: "AC", name: "Engineering" }).returning().get();
  const spec = db.insert(specializations).values({ slug: "sw", facultyId: faculty.id, degree: "bachelor", name: "Software" }).returning().get();
  const group = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "A" }).returning().get();
  for (const id of ["ana", "bea", "dan", "lia"]) {
    db.insert(users).values({ id, name: id, email: id + "@example.org", passwordHash: "test", feedToken: id }).run();
  }
  student = db.update(users).set({ facultyId: faculty.id, specializationId: spec.id, groupId: group.id, year: 1 }).where(eq(users.id, "ana")).returning().get();
  vi.mocked(getUser).mockResolvedValue(student);
  vi.mocked(getLocale).mockResolvedValue("ro");

  const term = db.select().from(semesters).where(eq(semesters.number, 1)).get()!;
  for (const name of ["Programare", "Hidden lab"]) {
    const course = db.insert(courses).values({ key: name, semesterId: term.id, facultyId: faculty.id, name }).returning().get();
    const row = db.insert(entries).values({ key: name, semesterId: term.id, courseId: course.id, kind: "lab", day: 2, startMin: 570, endMin: 630, rawText: name }).returning().get();
    db.insert(entryGroups).values({ groupId: group.id, entryId: row.id }).run();
    if (name === "Hidden lab") db.insert(userOverrides).values({ userId: "ana", entryId: row.id, hidden: true }).run();
    else db.insert(occurrenceOverrides).values({ userId: "ana", entryId: row.id, date: tomorrow, newDate: today, startMin: 600, endMin: 660, room: "A101" }).run();
  }
  db.insert(personalEvents).values([
    { userId: "ana", title: "Study physics", plan: "study:physics", date: today, startMin: 615, endMin: 675, location: "Library" },
    { userId: "ana", title: "Weekly swim", day: 2, startMin: 480, endMin: 540 },
    { userId: "ana", title: "Finished", date: today, startMin: 480, endMin: 540 },
    { userId: "ana", title: "In three days", date: "2026-11-26", startMin: 600, endMin: 660 },
    { userId: "bea", title: "Private appointment", date: today, startMin: 600, endMin: 660 },
  ]).run();
  for (const date of ["2026-12-23", "2026-12-24"]) {
    const exam = db.insert(exams).values({ key: date, facultyId: faculty.id, courseName: "Mechanics", year: 1, date, startMin: 540, endMin: 660, rawText: "Mechanics" }).returning().get();
    db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec.id }).run();
  }
  inviteContact("dan", student.email);
  inviteContact("ana", "lia@example.org");
  for (const id of ["confirmed", "pending", "expired", "declined"]) {
    db.insert(groupEvents).values({ id, creatorId: "bea", title: id, date: tomorrow, startMin: 660, endMin: 720,
      deadline: now.getTime() + (id === "expired" ? -1 : 60_000), status: id === "confirmed" ? "confirmed" : "pending" }).run();
    db.insert(eventParticipants).values([
      { userId: "bea", eventId: id, invited: true, response: "accepted" },
      { userId: "ana", eventId: id, invited: true, response: id === "confirmed" ? "accepted" : id === "declined" ? "declined" : "pending" },
    ]).run();
  }
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("the student notification feed", () => {
  it("opens the effective class, study blocks and confirmed events, nearest first, with localized details", async () => {
    const { upcoming, requests } = await feed();
    expect(upcoming.map((r) => r.title)).toEqual(["Programare", "Study physics", "Weekly swim", "confirmed", "Mechanics"]);
    expect(upcoming[0]).toMatchObject({ category: "Laborator", date: today, detail: expect.stringContaining("10:00 · Sala A101"), directionsHref: expect.stringContaining("to=A101") });
    const target = new URL(upcoming[0].href, "http://localhost");
    expect(target.searchParams.get("date")).toBe(today);
    expect(target.searchParams.get("event")).toMatch(/^e:\d+:2026-11-24$/);
    expect(upcoming[1].detail).toContain("Library");
    expect(upcoming[3].href).toBe("/contacts/events/confirmed");
    expect(upcoming[4]).toMatchObject({ category: "Examen", date: "2026-12-23", href: expect.stringMatching(/^\/exams#exam-\d+$/), tip: expect.any(String) });
    expect(requests.map((r) => [r.category, r.href])).toEqual([["Cerere de contact", "/contacts#inbox"], ["Invitație la eveniment", "/contacts/events/pending"]]);
    vi.mocked(getLocale).mockResolvedValue("en");
    expect((await feed()).upcoming[0]).toMatchObject({ category: "Lab", detail: expect.stringContaining("Room A101") });
  });

  it("drops resolved requests and moves an accepted invitation onto the attendee's calendar", async () => {
    answerContact("ana", "dan", false);
    respondToEvent({ eventId: "pending" }, { userId: "ana" }, "accepted");
    const data = await feed();
    expect(data.requests).toEqual([]);
    expect(data.upcoming.filter((r) => r.title === "pending")).toMatchObject([{ kind: "shared", href: "/contacts/events/pending" }]);
  });

  it("returns only the current account's data and rejects signed-out requests", async () => {
    vi.mocked(getUser).mockResolvedValue(db.select().from(users).where(eq(users.id, "lia")).get()!);
    expect(await feed()).toMatchObject({ userId: "lia", upcoming: [], requests: [{ id: "contact:ana" }] });
    expect((await GET()).headers.get("cache-control")).toContain("no-store");
    vi.mocked(getUser).mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
  });

  it("keeps an ongoing exam until it ends and expires a start-only exam at its published time", async () => {
    for (const [courseName, startMin] of [["In progress", 570], ["Start only", 600]] as const) {
      const exam = db.insert(exams).values({ key: courseName, courseName, facultyId: student.facultyId!, year: 1, date: today, startMin, endMin: 600, rawText: courseName }).returning().get();
      db.insert(examSpecializations).values({ examId: exam.id, specializationId: student.specializationId! }).run();
    }
    const ongoing = (await feed()).upcoming.find((r) => r.title === "In progress")!;
    expect(noticeCountdown(ongoing, now.getTime(), "en")).toBe("now");
    expect(alertKey(ongoing, now.getTime())).toBeNull();
    expect((await feed()).upcoming.some((r) => r.title === "Start only")).toBe(true);
    vi.setSystemTime(new Date("2026-11-23T08:00:00Z"));
    expect((await feed()).upcoming.filter((r) => r.title === "In progress" || r.title === "Start only")).toEqual([]);
  });

  it("includes the routine and exam alarms in actual calendar export items", () => {
    const items = exportItems(student);
    const ordinary = items.filter((item) => !item.uid.startsWith("exam-"));
    expect(ordinary.map((item) => item.uid)).toEqual(expect.arrayContaining([expect.stringMatching(/^entry-\d+-2026-11-24$/), expect.stringMatching(/^personal-/), "group-confirmed"]));
    expect(ordinary.every((item) => item.alarms?.join() === "15")).toBe(true);
    const exam = items.find((item) => item.uid.startsWith("exam-"))!;
    expect(exam.alarms).toEqual([1440, 120]);
    expect(toICS(ordinary).match(/TRIGGER:-PT15M/g)).toHaveLength(ordinary.length);
  });

  it("uses occurrence-specific keys at the actual alert boundaries and stops when an event starts", async () => {
    const { upcoming, requests } = await feed();
    const [lab, , , , exam] = upcoming;
    const before = (notice: ScheduledNotice, minutes: number) => alertKey(notice, notice.startsAt - minutes * 60_000);
    expect(before(lab, 15.01)).toBeNull();
    expect(before(lab, 15)).toBe(before(lab, 0.5));
    expect(before(lab, 15)).toMatch(/:15$/);
    expect(before(lab, 0)).toBeNull();
    expect(before({ ...lab, startsAt: lab.startsAt - 60_000 }, 15)).not.toBe(before(lab, 15));
    for (const m of [10080, 1440, 120, 30]) expect(before(exam, m)).toMatch(new RegExp(`:${m}$`));
    expect(before(exam, 10081)).toBeNull();
    expect(before(exam, 0)).toBeNull();
    expect(alertKey(requests[1], requests[1].expiresAt!)).toBeNull();
    expect(noticeCountdown({ ...lab, date: "2026-11-24", startsAt: Date.parse("2026-11-23T22:05:00Z") },
      Date.parse("2026-11-23T21:50:00Z"), "ro")).toBe("în 15 min");
  });
});
