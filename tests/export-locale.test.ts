import { beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getDb } from "@/db";
import { courses, entries, entryGroups, examSpecializations, exams, faculties, groups, semesters, specializations, users } from "@/db/schema";
import type { User } from "@/lib/auth";
import { exportItems } from "@/lib/export";
import { calendarEmail, emailCalendar } from "@/lib/export-email";
import { renewCalendarLink } from "@/app/(app)/settings/actions";
import { GET as calendarFeed } from "@/app/api/ics/[token]/route";
import { requireOnboardedUser } from "@/lib/auth";
import { messages } from "@/i18n/messages";

vi.mock("@/lib/auth", { spy: true });
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getT: () => messages.en }));

// A private in-memory database with the real migrations and seed data.
process.env.DATABASE_PATH = ":memory:";

let user: User;

beforeAll(() => {
  const db = getDb();
  const semester = db.select().from(semesters).where(and(eq(semesters.academicYear, "2026-2027"), eq(semesters.number, 1))).get()!;
  db.update(semesters).set({ isCurrent: false }).run();
  db.update(semesters).set({ isCurrent: true }).where(eq(semesters.id, semester.id)).run();

  const faculty = db.insert(faculties).values({ slug: "ac", name: "Automatică și Calculatoare", shortName: "AC" }).returning().get();
  const spec = db.insert(specializations).values({ facultyId: faculty.id, degree: "bachelor", name: "Calculatoare", slug: "calculatoare" }).returning().get();
  const groupId = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "1.1" }).returning().get().id;
  const courseId = db.insert(courses).values({ key: "ac-mate", semesterId: semester.id, facultyId: faculty.id, name: "Matematică", year: 1 }).returning().get().id;
  for (const [key, kind, weeks] of [["ac-mate-curs", "course", "all"], ["ac-mate-lab", "lab", "odd"]] as const) {
    const row = db
      .insert(entries)
      .values({ key, semesterId: semester.id, courseId, kind, day: 1, startMin: 480, endMin: kind === "lab" ? 480 : 600, weeks, rawText: key, room: "A101" })
      .returning()
      .get();
    db.insert(entryGroups).values({ entryId: row.id, groupId }).run();
  }
  const exam = db
    .insert(exams)
    .values({ key: "ac-exam-mate", facultyId: faculty.id, courseName: "Matematică", date: "2027-01-20", startMin: 540, endMin: 660, room: "A204", year: 1, rawText: "x" })
    .returning()
    .get();
  db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec.id }).run();
  user = db
    .insert(users)
    .values({ id: "u1", email: "s@example.com", name: "S", passwordHash: "x", feedToken: "t", facultyId: faculty.id, specializationId: spec.id, year: 1, groupId })
    .returning()
    .get();
});

describe("calendar export language", () => {
  const texts = (items: ReturnType<typeof exportItems>) => items.map((i) => `${i.title} | ${i.description}`).join("\n");

  it("stays in English for an account without a language", () => {
    const all = texts(exportItems(user));
    expect(all).toContain("Matematică (Lecture)");
    expect(all).toContain("Matematică (Lab)");
    expect(all).toContain("odd weeks · End time unpublished");
    expect(all).toContain("Exam: Matematică · A204 | Room A204 · Good luck! 🍀");
  });

  it("follows the account's language, or the one asked for", () => {
    const ro = texts(exportItems({ ...user, locale: "ro" }));
    expect(ro).toContain("Matematică (Curs)");
    expect(ro).toContain("Matematică (Laborator)");
    expect(ro).toContain("săptămâni impare · Ora de sfârșit nu e publicată");
    expect(ro).toContain("Examen: Matematică · A204 | Sala A204 · Baftă! 🍀");
    expect(ro).not.toMatch(/Lecture|Exam:|Good luck/);
    // An explicit language wins over the account's.
    expect(texts(exportItems({ ...user, locale: "ro" }, "en"))).toContain("(Lecture)");
  });

  it("writes the e-mail in the student's language", () => {
    const en = calendarEmail({ ics: "X", semester: "semester 1, 2026-2027", feedUrl: null });
    expect(en.subject).toBe("Your UPT timetable");
    const ro = calendarEmail({ ics: "X", semester: "semestrul 1, 2026-2027", feedUrl: "https://orar.example.ro/api/ics/abc.ics", locale: "ro" });
    expect(ro.subject).toBe("Orarul tău UPT");
    expect(ro.text).toContain("din semestrul 1, 2026-2027");
    expect(ro.text).toContain("Adaugă tot");
    expect(ro.text).toContain("https://orar.example.ro/api/ics/abc.ics");
    expect(ro.text).not.toMatch(/Hi,|calendar today|Import & export/);
    expect(ro.attachments[0].filename).toBe("poli.ics");
  });

  it("replaces only the signed-in student's subscription and serves the new link immediately", async () => {
    const db = getDb();
    db.insert(users).values({ id: "other", name: "Other", email: "other@example.com", passwordHash: "x", feedToken: "other-feed" }).run();
    const read = (token: string) => calendarFeed(new Request(`https://orar.example.org/api/ics/${token}`), { params: Promise.resolve({ token }) });
    expect((await read(user.feedToken)).status).toBe(200);
    vi.mocked(requireOnboardedUser).mockResolvedValueOnce(user);
    await renewCalendarLink();
    const renewed = db.select().from(users).where(eq(users.id, user.id)).get()!;
    expect((await read(user.feedToken + ".ics")).status).toBe(404);
    const feed = await read(renewed.feedToken + ".ics");
    expect(feed.headers.get("cache-control")).toContain("no-store");
    expect(await feed.text()).toContain("BEGIN:VCALENDAR");
    expect((await read("other-feed")).status).toBe(200);
  });

  it.each([
    { to: "friend@example.com", rememberAddress: false, includesFeed: false, saved: "alternate@example.com" },
    { to: "friend@example.com", rememberAddress: true, includesFeed: false, saved: "friend@example.com" },
    { to: " ALTERNATE@example.com ", rememberAddress: false, includesFeed: true, saved: "alternate@example.com" },
    { to: "s@example.com", rememberAddress: false, includesFeed: true, saved: "alternate@example.com" },
  ])("sends a snapshot to $to and preserves the requested address preference ($rememberAddress)", async (test) => {
    const db = getDb();
    const account = db.update(users).set({ exportEmail: "alternate@example.com", calendarEmailedAt: null })
      .where(eq(users.id, user.id)).returning().get();
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const send = vi.spyOn(transport, "sendMail");
    vi.stubEnv("APP_URL", "https://orar.example.org");
    try {
      expect(await emailCalendar(account, test.to, transport, "en", { rememberAddress: test.rememberAddress })).toMatchObject({ ok: true });
      const [message] = send.mock.calls[0];
      expect(message.attachments?.[0].content).toContain("BEGIN:VCALENDAR");
      expect(String(message.text).includes(`/api/ics/${account.feedToken}`)).toBe(test.includesFeed);
      expect(db.select().from(users).where(eq(users.id, user.id)).get()?.exportEmail).toBe(test.saved);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
