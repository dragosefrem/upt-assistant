import { eq } from "drizzle-orm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GET as readCalendar } from "@/app/api/events/route";
import { POST as changeSchedule } from "@/app/api/schedule/route";
import { getDb } from "@/db";
import {
  courses, entries, entryGroups, eventParticipants, exams, examSpecializations, faculties, groupEvents, groups,
  occurrenceOverrides, personalEvents, semesters, specializations, sponsoredEvents, uptEventOccurrences, userCourses, users,
} from "@/db/schema";
import { messages } from "@/i18n/messages";
import { getUser, type User } from "@/lib/auth";
import { exportItems, toICS } from "@/lib/export";
import { eventsBetween, type CalEvent } from "@/lib/schedule";
import { respondToSponsoredEvent } from "@/lib/sponsored-events";
import { isUptSubscriber } from "@/lib/upt-events";
import { fetchUrl } from "@/scraper/http";
import { refreshUptEventsIfDue, startUptEventSync } from "@/scraper/upt-event-sync";
import { fetchUptEventOccurrences } from "@/scraper/upt-events";

vi.mock("@/lib/auth", async (load) => ({ ...(await load<typeof import("@/lib/auth")>()), getUser: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getLocale: async () => "en", getT: async () => messages.en }));
vi.mock("@/scraper/http", () => ({ fetchUrl: vi.fn() }));

const date = "2026-11-26";
const future = "2027-05-14";
const minute = 60_000;
const source = { id: 44, title: "Tech Talks", slug: "tech-talks", location: { name: "UPT" }, dates: [
  { id: "morning", date: `${future}T12:00:00.000Z`, startTime: "2026-11-12T07:00:00.000Z", endTime: "2026-11-12T16:00:00.000Z" },
  { id: "start-only", date: "2027-05-15T12:00:00.000Z", startTime: "2026-11-12T07:00:00.000Z", endTime: null },
] };
function page(docs: typeof source[], page = 1, hasNextPage = false, totalDocs = docs.length) {
  return { url: "", finalUrl: "", status: 200, contentType: "application/json",
    body: Buffer.from(JSON.stringify({ docs, page, hasNextPage, totalDocs })) };
}
let student: User;
let other: User;
beforeEach(() => {
  vi.stubEnv("DATABASE_PATH", ":memory:");
  vi.stubGlobal("__uptDb", undefined);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-23T10:00:00Z"));
  vi.mocked(fetchUrl).mockReset();
  const account = (id: string) => getDb().insert(users).values({ id, name: id, email: `${id}@example.org`,
    passwordHash: "fixture", feedToken: id, onboardedAt: date }).returning().get();
  student = account("ana");
  other = account("dan");
  vi.mocked(getUser).mockResolvedValue(student);
});
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it("refreshes without requests, pages the source, and retains the last good snapshot across failures", async () => {
  vi.stubGlobal("__uptEventsTimer", undefined);
  const second = { ...source, id: 45, title: "Open lab", slug: "open-lab" };
  vi.mocked(fetchUrl).mockResolvedValueOnce(page([source], 1, true, 2)).mockResolvedValueOnce(page([second], 2, false, 2));
  startUptEventSync();
  startUptEventSync();
  await vi.advanceTimersByTimeAsync(0);
  const rows = () => getDb().select().from(uptEventOccurrences).all();
  expect(rows()).toHaveLength(2);
  expect(rows()[0]).toMatchObject({ id: "44:morning", date: future, startMin: 540, endMin: 1080, sourceUrl: "https://www.upt.ro/evenimente/tech-talks" });
  const requests = vi.mocked(fetchUrl).mock.calls.map(([url, options]) => {
    const query = new URL(url).searchParams;
    return [query.get("page"), query.get("where[site][equals]"), query.get("where[_status][equals]"), options?.cache];
  });
  expect(requests).toEqual([["1", "3", "published", "no-store"], ["2", "3", "published", "no-store"]]);
  await vi.advanceTimersByTimeAsync(29 * minute);
  expect(fetchUrl).toHaveBeenCalledTimes(2);
  const warning = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    vi.mocked(fetchUrl).mockResolvedValueOnce(page([source], 1, true, 2)).mockRejectedValueOnce(new Error("offline"));
    await vi.advanceTimersByTimeAsync(minute);
    expect(rows()).toHaveLength(2);
    expect(warning).toHaveBeenCalledOnce();
    vi.mocked(fetchUrl).mockResolvedValueOnce(page([{ ...source, title: "Updated talk" }]));
    await vi.advanceTimersByTimeAsync(5 * minute);
    expect(rows()).toMatchObject([{ id: "44:morning", title: "Updated talk" }]);
  } finally { warning.mockRestore(); }
});

it("keeps each dated session independently and skips wall times lost to daylight saving", async () => {
  const dated = (id: string, eventDay: string, from: string, until: string) => ({
    id, date: eventDay + "T12:00:00Z", startTime: `2026-11-12T${from}:00Z`, endTime: `2026-11-12T${until}:00Z`,
  });
  vi.mocked(fetchUrl).mockResolvedValueOnce(page([{ ...source, dates: [
    dated("opening", "2027-03-27", "16:00", "22:00"), // 18:00 through midnight
    dated("clock-change", "2027-03-28", "01:30", "03:30"), // 03:30 does not exist on the event day
    dated("closing", "2027-03-29", "06:00", "07:00"),
  ] }]));
  expect(await fetchUptEventOccurrences()).toMatchObject([
    { id: "44:opening", date: "2027-03-27", startMin: 1080, endMin: 1440 },
    { id: "44:closing", date: "2027-03-29", startMin: 480, endMin: 540 },
  ]);
});

it("never publishes a truncated collection and shares the refresh lease between concurrent calls", async () => {
  vi.mocked(fetchUrl).mockResolvedValueOnce(page([source]));
  await Promise.all([refreshUptEventsIfDue(), refreshUptEventsIfDue()]);
  expect(fetchUrl).toHaveBeenCalledOnce();
  vi.setSystemTime(Date.now() + 30 * minute);
  vi.mocked(fetchUrl).mockResolvedValueOnce(page([], 1, false, 1));
  await expect(refreshUptEventsIfDue()).rejects.toThrow("Incomplete");
  expect(getDb().select().from(uptEventOccurrences).all()).toHaveLength(1);
  vi.setSystemTime(Date.now() + 5 * minute);
  vi.mocked(fetchUrl).mockResolvedValueOnce(page([]));
  await refreshUptEventsIfDue();
  expect(getDb().select().from(uptEventOccurrences).all()).toEqual([]);
});

const toggle = (subscribed: boolean) => changeSchedule(new Request("http://localhost/api/schedule", {
  method: "POST", body: JSON.stringify({ action: "uptSubscription", subscribed, userId: other.id }),
}));
const calendar = async (offers = false) => (await readCalendar(new Request(
  `http://localhost/api/events?from=${date}&to=${date}${offers ? "&offers=1" : ""}`))).json();
function session(id: string, startMin: number, endMin: number, location?: string) {
  getDb().insert(uptEventOccurrences).values({ id, title: id, date, startMin, endMin, location, sourceUrl: `https://www.upt.ro/evenimente/${id}` }).run();
}

it("subscribes only the signed-in account and resolves whole slots again after calendar edits", async () => {
  session("Workshop", 840, 900, "Sala B419");
  session("Overlapping talk", 875, 940);
  session("Evening", 900, 960);
  const titles = async () => (await calendar()).events.map((e: { title: string }) => e.title);
  expect(await titles()).toEqual([]);
  expect((await toggle(true)).ok).toBe(true);
  expect((await toggle(true)).ok).toBe(true);
  expect(isUptSubscriber(other.id)).toBe(false);
  expect(await titles()).toEqual(["Workshop", "Evening"]);
  expect((await calendar()).events[0]).toMatchObject({ title: "Workshop", campusRoom: "B419" });
  expect((await calendar(true)).uptSubscribed).toBe(true);
  const db = getDb();
  const meeting = db.insert(personalEvents).values({ userId: student.id, title: "My weekly lab", day: 4, startMin: 890, endMin: 900 }).returning().get();
  expect(await titles()).toEqual(["My weekly lab", "Evening"]);
  db.delete(personalEvents).where(eq(personalEvents.id, meeting.id)).run();
  expect(await titles()).toEqual(["Workshop", "Evening"]);
  expect(eventsBetween(student, date, date)).toEqual([]);
  expect(toICS(exportItems(student))).toContain("TRANSP:TRANSPARENT");
  vi.mocked(getUser).mockResolvedValue(other);
  expect(await titles()).toEqual([]);
  vi.mocked(getUser).mockResolvedValue(student);
  await toggle(false);
  expect(await titles()).toEqual([]);
  expect(exportItems(student)).toEqual([]);
  vi.mocked(getUser).mockResolvedValue(null);
  expect((await toggle(true)).status).toBe(401);
});

it("matches classmates separately using each chosen lab, one-week moves, and exams", async () => {
  const db = getDb();
  const faculty = db.insert(faculties).values({ name: "Engineering", slug: "engineering" }).returning().get();
  const spec = db.insert(specializations).values({ name: "Software", slug: "software", degree: "bachelor", facultyId: faculty.id }).returning().get();
  const group = db.insert(groups).values({ name: "2.1", year: 2, specializationId: spec.id }).returning().get();
  const profile = { facultyId: faculty.id, specializationId: spec.id, groupId: group.id, year: 2 };
  const term = db.select().from(semesters).where(eq(semesters.isCurrent, true)).get()!;
  const course = db.insert(courses).values({ key: "graphics", name: "Graphics", semesterId: term.id, facultyId: faculty.id }).returning().get();
  const lab = (key: string, startMin: number) => db.insert(entries).values({
    key, kind: "lab", isSlotOption: true, courseId: course.id, semesterId: term.id,
    day: 4, startMin, endMin: startMin + 60, rawText: "Graphics lab",
  }).returning().get();
  const early = lab("early", 540);
  const late = lab("late", 660);
  db.insert(entryGroups).values([early, late].map((e) => ({ groupId: group.id, entryId: e.id }))).run();
  for (const [account, chosen] of [[student, early], [other, late]] as const) {
    db.update(users).set(profile).where(eq(users.id, account.id)).run();
    db.insert(userCourses).values({ userId: account.id, courseId: course.id, slotEntryId: chosen.id }).run();
    vi.mocked(getUser).mockResolvedValue({ ...account, ...profile });
    await toggle(true);
  }
  const exam = db.insert(exams).values({ key: "exam", courseName: "Exam", rawText: "", date, startMin: 795,
    endMin: 825, facultyId: faculty.id, year: 2 }).returning().get();
  db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec.id }).run();
  session("Morning talk", 540, 600);
  session("Midday talk", 660, 720);
  session("Talk during the exam", 780, 840);
  const matches = async (account: User) => {
    vi.mocked(getUser).mockResolvedValue({ ...account, ...profile });
    const { events }: { events: CalEvent[] } = await calendar();
    return events.filter((e) => e.type === "upt").map((e) => e.title);
  };
  expect(await matches(student)).toEqual(["Midday talk"]);
  expect(await matches(other)).toEqual(["Morning talk"]);
  db.insert(occurrenceOverrides).values({ entryId: early.id, userId: student.id, date, newDate: date, startMin: 900, endMin: 960 }).run();
  expect(await matches(student)).toEqual(["Morning talk", "Midday talk"]);
});

it("gives accepted invitations, unknown finishes and saved sponsors precedence over the university layer", async () => {
  session("University morning", 600, 660);
  session("University afternoon", 840, 900);
  session("University evening", 1080, 1140);
  await toggle(true);
  const db = getDb();
  db.insert(groupEvents).values({ id: "group", creatorId: student.id, title: "Group plan", date, startMin: 630, endMin: 690,
    deadline: Date.now() + 60 * minute, status: "pending" }).run();
  db.insert(eventParticipants).values({ eventId: "group", userId: student.id, response: "accepted" }).run();
  db.insert(personalEvents).values({ userId: student.id, title: "Start only", date, startMin: 1000, endMin: 1000 }).run();
  const sponsor = db.insert(sponsoredEvents).values({ id: "a".repeat(64), title: "Sponsored lab", sponsor: "Partner", date,
    startMin: 840, endMin: 900, location: "A101", description: "", facultyIds: [], years: [] }).returning().get();
  const before = await calendar(true);
  expect(before.events.filter((e: CalEvent) => e.type === "upt").map((e: CalEvent) => e.title)).toEqual(["University afternoon"]);
  expect(before.offers.map((e: { title: string }) => e.title)).toEqual(["Sponsored lab"]);
  expect(respondToSponsoredEvent(student.id, sponsor.id, "save")).toBe(true);
  expect((await calendar()).events.filter((e: CalEvent) => e.type === "upt")).toEqual([]);
  await toggle(false);
  expect((await calendar()).events.some((e: CalEvent) => e.type === "sponsored")).toBe(true);
});
