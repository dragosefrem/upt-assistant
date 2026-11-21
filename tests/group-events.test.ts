import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as restoreGuest } from "@/app/join/[token]/manage/[key]/route";
import { generateMetadata as guestMetadata } from "@/app/join/[token]/page";
import { getDb } from "@/db";
import { courses, entries, entryGroups, exams, examSpecializations, faculties, groups, personalEvents, semesters, specializations, userOverrides, users } from "@/db/schema";
import { messages } from "@/i18n/messages";
import * as i18nServer from "@/i18n/server";
import { answerContact, cancelContactRequest, contactList, findPerson, incomingContactCount, invitationFailure, InvitationError, inviteContact, removeContact } from "@/lib/contacts";
import { contactWeek } from "@/lib/contact-schedule";
import { exportItems, toICS } from "@/lib/export";
import { groupInviteCount, memberEvent, myGroupEvents, publicEvent, respondToEvent, sharedEventsFor } from "@/lib/group-events";
import { createGroupEvent, groupAvailability } from "@/lib/group-planning";
import { planningRange } from "@/lib/planning-range";
import { currentSemester, eventsBetween } from "@/lib/schedule";
import { localInstant } from "@/lib/time";

vi.stubEnv("DATABASE_PATH", ":memory:");
const monday = new Date("2026-11-16T09:00:00Z"); // 11:00 on campus
vi.useFakeTimers({ toFake: ["Date"] });
vi.setSystemTime(monday);
const db = getDb();
const friday = "2026-11-20";
const booking = {
  contactIds: ["bea", "cam"], title: "Football night", location: "West pitch",
  date: friday, startMin: 18 * 60, duration: 60, deadline: "2026-11-19T12:00", share: false,
};
const account = (id: string) => db.select().from(users).where(eq(users.id, id)).get()!;
const host = () => account("alex");
function connect(id: string) {
  inviteContact("alex", account(id).email);
  answerContact(id, "alex", true);
}
function plan(options: Partial<typeof booking> = {}) {
  const details = { ...booking, ...options };
  details.contactIds.forEach(connect);
  return createGroupEvent(host(), details);
}
const reply = (eventId: string, userId: string, response: "accepted" | "declined") =>
  respondToEvent({ eventId }, { userId }, response);
const calendar = (id: string) => eventsBetween(account(id), friday, friday).filter((e) => e.type === "shared");

beforeEach(() => {
  vi.setSystemTime(monday);
  db.delete(users).run();
  db.delete(faculties).run();
  for (const id of ["alex", "bea", "cam", "dan"]) {
    db.insert(users).values({ id, name: id, email: `${id}@example.org`, passwordHash: "test", feedToken: id }).run();
  }
});
afterAll(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("contact requests", () => {
  it("uses exact normalized addresses and one request per pair, in either direction", () => {
    expect(findPerson("  BEA@EXAMPLE.ORG ")?.id).toBe("bea");
    expect(findPerson("bea")).toBeUndefined();
    expect(() => inviteContact("alex", "not-an-email")).toThrow(/valid e-mail/);
    expect(() => inviteContact("alex", "nobody@example.org")).toThrow(/No account/);
    expect(() => inviteContact("alex", host().email)).toThrow(/another person/);
    inviteContact("alex", "bea@example.org");
    inviteContact("bea", host().email);
    expect(contactList("alex")).toHaveLength(1);
    expect(incomingContactCount("bea")).toBe(1);
    answerContact("alex", "bea", true);
    cancelContactRequest("bea", "alex");
    expect(contactList("bea")[0].accepted).toBe(false);
    answerContact("bea", "alex", false);
    expect(contactList("alex")).toHaveLength(0);
    connect("bea");
    expect(incomingContactCount("bea")).toBe(0);
    expect(contactList("bea")[0]).toMatchObject({ id: "alex", accepted: true });
    expect(contactList("cam")).toHaveLength(0);
    removeContact("bea", "alex");
    expect(() => groupAvailability(host(), ["bea"])).toThrow(/accepted contacts/);
  });
});

describe("contact schedules", () => {
  it("permits both people only while their contact request is accepted", () => {
    expect(contactWeek("dan", "bea")).toBeNull();
    inviteContact("bea", host().email);
    expect(contactWeek("bea", "alex")).toBeNull();
    expect(contactWeek("alex", "bea")).toBeNull();
    answerContact("alex", "bea", true);
    expect(contactWeek("alex", "bea", friday)).toMatchObject({ name: "bea", from: "2026-11-16", to: "2026-11-22" });
    expect(contactWeek("bea", "alex", "2026-11-29")?.from).toBe("2026-11-23");
    for (const invalid of ["2026-02-30", "9999-12-31", "invalid"]) {
      expect(contactWeek("bea", "alex", invalid)?.from).toBe("2026-11-16");
    }
    removeContact("alex", "bea");
    expect(contactWeek("bea", "alex")).toBeNull();
    expect(contactWeek("alex", "bea")).toBeNull();
  });

  it("shows shared event details only to fellow attendees and redacts other busy time", () => {
    const together = plan({ contactIds: ["bea"], title: "Study group", startMin: 900 });
    const separate = plan({ contactIds: ["cam"], title: "Private meetup", startMin: 1080 });
    reply(separate, "cam", "accepted");
    db.insert(personalEvents).values({ userId: "alex", date: friday, startMin: 600, endMin: 630,
      title: "Private appointment", location: "Private address" }).run();

    const busy = (startMin: number, endMin: number) => ({ date: friday, startMin, endMin, title: "Busy", kind: "busy", room: null });
    const peek = () => contactWeek("bea", "alex", friday)!.events;
    expect(peek()).toEqual([busy(600, 630), busy(900, 960), busy(1080, 1140)]);
    reply(together, "bea", "accepted");
    expect(peek()).toEqual([
      busy(600, 630),
      { date: friday, startMin: 900, endMin: 960, title: "Study group", kind: "shared", room: "West pitch" },
      busy(1080, 1140),
    ]);
  });
});

describe("finding a time together", () => {
  it("combines effective classes, exams and personal appointments and returns only free intervals", () => {
    connect("bea");
    const faculty = db.insert(faculties).values({ name: "Engineering", slug: "eng" }).returning().get();
    const spec = db.insert(specializations).values({ name: "Software", slug: "sw", degree: "bachelor", facultyId: faculty.id }).returning().get();
    const group = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "A" }).returning().get();
    db.update(users).set({ facultyId: faculty.id, specializationId: spec.id, year: 1, groupId: group.id }).where(eq(users.id, "bea")).run();
    const semesterId = currentSemester()!.id;
    const course = db.insert(courses).values({ key: "c1", name: "Private class", semesterId, facultyId: faculty.id }).returning().get();
    const entry = db.insert(entries).values({ key: "e1", day: 1, startMin: 480, endMin: 600, courseId: course.id, kind: "course", semesterId, rawText: "" }).returning().get();
    db.insert(entryGroups).values({ groupId: group.id, entryId: entry.id }).run();
    db.insert(userOverrides).values({ entryId: entry.id, userId: "bea", day: 5, startMin: 600, endMin: 720, room: "A1", note: "My private note" }).run();
    const exam = db.insert(exams).values({ key: "x", year: 1, courseName: "Private exam", facultyId: faculty.id,
      date: friday, startMin: 780, endMin: 840, rawText: "" }).returning().get();
    db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec.id }).run();
    db.insert(personalEvents).values({ userId: "alex", title: "Appointment", day: 5, startMin: 660, endMin: 780 }).run();
    const slots = groupAvailability(host(), ["bea", "bea"]);
    expect(slots.filter((s) => s.date === friday)).toEqual([
      { date: friday, startMin: 0, endMin: 600 }, { date: friday, startMin: 840, endMin: 1440 },
    ]);
    expect(slots[0]).toEqual({ date: "2026-11-16", startMin: 661, endMin: 1440 });
    expect(slots.at(-1)?.date).toBe("2026-11-22");
    expect(contactWeek("alex", "bea", friday)?.events).toEqual([
      { date: friday, startMin: 600, endMin: 720, title: "Private class", kind: "course", room: "A1" },
      { date: friday, startMin: 780, endMin: 840, title: "Private exam", kind: "exam", room: null },
    ]);
    expect(() => createGroupEvent(host(), { ...booking, contactIds: ["bea"], startMin: 650 })).toThrow(/no longer free/);
    expect(() => groupAvailability(host(), ["dan"])).toThrow(/accepted contacts/);

    const spring = db.select().from(semesters).where(eq(semesters.number, 2)).get()!;
    const springCourse = db.insert(courses).values({ key: "c2", name: "Spring lab", semesterId: spring.id, facultyId: faculty.id }).returning().get();
    const springLab = db.insert(entries).values({ key: "e2", day: 1, startMin: 900, endMin: 960, courseId: springCourse.id, kind: "lab", semesterId: spring.id, rawText: "" }).returning().get();
    db.insert(entryGroups).values({ groupId: group.id, entryId: springLab.id }).run();
    const springMonday = "2027-03-01";
    expect(groupAvailability(host(), ["bea"], { from: springMonday, to: springMonday })).toEqual([
      { date: springMonday, startMin: 0, endMin: 900 }, { date: springMonday, startMin: 960, endMin: 1440 },
    ]);
    expect(() => createGroupEvent(host(), { ...booking, contactIds: ["bea"], date: springMonday, startMin: 900 })).toThrow(/no longer free/);
  });

  it("validates the deadline, date, attendees and boundaries again at booking time", () => {
    connect("bea");
    const make = (options: Partial<typeof booking>) => createGroupEvent(host(), { ...booking, contactIds: ["bea"], ...options });
    expect(() => make({ contactIds: [] })).toThrow(/guest link/);
    expect(() => make({ contactIds: ["dan"] })).toThrow(/accepted contacts/);
    expect(() => make({ date: "2026-11-15" })).toThrow(/future time/);
    expect(() => make({ duration: 500 })).toThrow(/duration/);
    expect(() => make({ deadline: "2026-11-16T10:59" })).toThrow(/deadline/);
    expect(() => make({ deadline: "2026-11-20T18:01" })).toThrow(/deadline/);
    const id = make({});
    expect(() => make({})).toThrow(/no longer free/);
    expect(sharedEventsFor("alex")).toHaveLength(0);
    expect(myGroupEvents("bea").map((e) => e.id)).toEqual([id]);
    expect(myGroupEvents("dan")).toEqual([]);
  });

  it("opens a full seven days on Saturday and can book and recheck a date several months out", () => {
    vi.setSystemTime(new Date("2026-11-21T12:00:00Z"));
    connect("bea");
    const days = groupAvailability(host(), ["bea"]);
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ date: "2026-11-21", startMin: 841, endMin: 1440 });
    expect(days.at(-1)?.date).toBe("2026-11-27");
    const date = "2027-02-01";
    const page = planningRange("2026-11-21", { from: "2026-11-21", to: date, page: "3" });
    expect(groupAvailability(host(), ["bea"], page.visible).at(-1)).toEqual({ date, startMin: 0, endMin: 1440 });
    const details = { ...booking, date, contactIds: ["bea"], deadline: "2027-01-30T18:00" };
    const id = createGroupEvent(host(), details);
    expect(() => createGroupEvent(host(), details)).toThrow(/no longer free/);
    reply(id, "bea", "accepted");
    expect(eventsBetween(account("bea"), date, date)).toMatchObject([{ date, groupEventId: id }]);
  });
});

describe("group RSVPs and calendars", () => {
  it("confirms on unanimity, including after a decline, and follows subsequent attendance", () => {
    const id = plan();
    expect(groupInviteCount("bea")).toBe(1);
    expect(memberEvent("dan", id)).toBeNull();
    expect(() => reply(id, "dan", "accepted")).toThrow(/unavailable/);
    reply(id, "bea", "accepted");
    reply(id, "cam", "declined");
    expect(calendar("bea")).toEqual([]);
    reply(id, "cam", "accepted");
    expect(groupInviteCount("bea")).toBe(0);
    expect(calendar("bea")).toMatchObject([{ title: "Football night", room: "West pitch", groupEventId: id }]);
    expect(toICS(exportItems(account("cam")))).toContain(`UID:group-${id}@upt-orar`);
    expect(groupAvailability(account("bea"), []).filter((s) => s.date === friday)).toHaveLength(2);
    reply(id, "cam", "declined");
    expect(calendar("cam")).toEqual([]);
    expect(calendar("alex")).toHaveLength(1);
    reply(id, "alex", "declined");
    expect(calendar("bea")).toEqual([]);
    reply(id, "cam", "accepted");
    expect(calendar("bea")).toHaveLength(1);
    expect(calendar("alex")).toHaveLength(0);
  });

  it("publishes only timely acceptances at the exact cutoff, even without another write", () => {
    const id = plan();
    reply(id, "bea", "accepted");
    vi.setSystemTime(new Date("2026-11-19T09:59:59.999Z"));
    expect(calendar("alex")).toHaveLength(0);
    vi.setSystemTime(new Date("2026-11-19T10:00:00.000Z"));
    expect(calendar("alex")).toHaveLength(1);
    expect(exportItems(account("bea")).some((e) => e.uid === `group-${id}`)).toBe(true);
    expect(calendar("cam")).toHaveLength(0);
    reply(id, "bea", "declined"); // first post-cutoff write must preserve the outcome
    expect(memberEvent("alex", id)).toMatchObject({ status: "confirmed", going: 1 });
    reply(id, "cam", "accepted");
    expect(calendar("cam")).toHaveLength(1);
    expect(calendar("bea")).toHaveLength(0);
  });

  it("expires a proposal below quorum before processing a late first reply or link join", () => {
    const id = plan({ share: true });
    const token = memberEvent("alex", id)!.shareToken!;
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    expect(() => reply(id, "bea", "accepted")).toThrow(/expired/);
    expect(() => respondToEvent({ shareToken: token }, { guestKey: "one", name: "One" }, "accepted")).toThrow(/expired/);
    expect(publicEvent(token)).toMatchObject({ status: "expired", going: 1 });
    expect(calendar("alex")).toHaveLength(0);
    expect(groupInviteCount("bea")).toBe(0);
  });

  it("can confirm for two contacts after the organizer withdraws", () => {
    const id = plan();
    reply(id, "alex", "declined");
    reply(id, "bea", "accepted");
    reply(id, "cam", "accepted");
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    expect(calendar("alex")).toHaveLength(0);
    expect(calendar("bea")).toHaveLength(1);
    expect(calendar("cam")).toHaveLength(1);
  });
});

describe("shareable invitations", () => {
  it("keeps the guest URL private while preserving the origin on a native RSVP submission", async () => {
    const locale = vi.spyOn(i18nServer, "getT").mockResolvedValue(messages.en);
    try {
      expect(await guestMetadata()).toMatchObject({ referrer: "strict-origin", robots: { index: false, follow: false } });
    } finally {
      locale.mockRestore();
    }
  });

  it("lets guests join a link-only event, revise their own seat and carry it into an account", () => {
    const id = plan({ contactIds: [], share: true, startMin: 1380 });
    const token = memberEvent("alex", id)!.shareToken!;
    const invite = { shareToken: token };
    const guest = { guestKey: "caseys-private-key", name: "Casey" };
    expect(publicEvent(id)).toBeNull();
    respondToEvent(invite, guest, "accepted");
    respondToEvent(invite, guest, "accepted");
    expect(publicEvent(token, undefined, guest.guestKey)).toMatchObject({ going: 2, response: "accepted" });
    expect(publicEvent(token, undefined, "someone-else")?.response).toBeNull();
    expect(toICS(exportItems(host()))).toContain("DTEND;TZID=Europe/Bucharest:20261121T000000");
    respondToEvent(invite, { userId: "dan", guestKey: guest.guestKey }, "accepted");
    expect(memberEvent("dan", id)).toMatchObject({ going: 2, shareToken: null });
    expect(memberEvent("alex", id)?.roster).toHaveLength(2);
    expect(publicEvent(token, undefined, guest.guestKey)?.response).toBeNull();
    expect(calendar("dan")).toHaveLength(1);
    respondToEvent(invite, { guestKey: "other-key", name: "Another guest" }, "accepted");
    respondToEvent(invite, { guestKey: "other-key", name: "" }, "declined");
    expect(memberEvent("alex", id)?.going).toBe(2);
  });

  it("waits for the named group even when guests join and allows the same name on separate seats", () => {
    const id = plan({ share: true });
    const token = memberEvent("alex", id)!.shareToken!;
    for (const key of ["first", "second"]) respondToEvent({ shareToken: token }, { guestKey: key, name: "Sam" }, "accepted");
    respondToEvent({ shareToken: token }, { guestKey: "first", name: "" }, "declined");
    expect(publicEvent(token, undefined, "second")).toMatchObject({ status: "pending", response: "accepted" });
    reply(id, "bea", "accepted");
    reply(id, "cam", "accepted");
    expect(memberEvent("alex", id)).toMatchObject({ status: "confirmed", going: 4 });
  });

  it("restores a guest on a new device using only their own event-specific edit link", async () => {
    const id = plan({ contactIds: [], share: true });
    const token = memberEvent("alex", id)!.shareToken!;
    const key = "K".repeat(43);
    respondToEvent({ shareToken: token }, { guestKey: key, name: "Visitor" }, "accepted");
    const restore = (token: string, key: string) => restoreGuest(new Request("https://example.org"), {
      params: Promise.resolve({ token, key }),
    });
    const result = await restore(token, key);
    expect(result.status).toBe(303);
    expect(result.headers.get("referrer-policy")).toBe("no-referrer");
    expect(result.headers.get("location")).toBe(`/join/${token}`);
    expect(result.headers.get("set-cookie")).toContain(`Path=/join/${token}`);
    expect((await restore(token, "J".repeat(43))).status).toBe(404);
    expect((await restore("another-event", key)).status).toBe(404);
    respondToEvent({ shareToken: token }, { userId: "cam", guestKey: key }, "accepted");
    expect((await restore(token, key)).status).toBe(404);
  });
});

it("resolves creator deadlines in campus time across clock changes", () => {
  expect(localInstant("2026-03-29T03:15")).toBeNull();
  expect(localInstant("2026-10-25T03:15")).toBe(Date.parse("2026-10-25T00:15:00Z"));
  expect(localInstant("2026-02-30T20:00")).toBeNull();
});

it("keeps a stable code on invitation errors and shows them in the visitor's language", () => {
  const error = (() => { try { inviteContact("alex", "nobody@example.org"); } catch (e) { return e; } })();
  expect(error).toBeInstanceOf(InvitationError);
  expect(error).toMatchObject({ code: "noAccount", message: "No account has that e-mail address." });
  expect(invitationFailure(error)).toEqual({ error: "No account has that e-mail address." });
  expect(invitationFailure(error, "ro")).toEqual({ error: "Niciun cont nu are adresa asta de e-mail." });
  expect(() => invitationFailure(new Error("disk full"), "ro")).toThrow("disk full");
  connect("bea");
  db.insert(personalEvents).values({ userId: "bea", title: "Dentist", day: 5, startMin: 600, endMin: 660 }).run();
  expect(contactWeek("alex", "bea", friday, "ro")?.events).toEqual([
    { date: friday, startMin: 600, endMin: 660, title: "Ocupat", kind: "busy", room: null },
  ]);
});
