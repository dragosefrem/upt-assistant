import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { getDb } from "@/db";
import { courses, entries, entryGroups, examSpecializations, exams, faculties, groups, semesters, specializations, users } from "@/db/schema";
import type { User } from "@/lib/auth";
import { exportItems, toICS } from "@/lib/export";
import { syncToGoogle } from "@/lib/google";
import { calendarEmail, emailCalendar } from "@/lib/export-email";
import { renewCalendarLink } from "@/app/(app)/settings/actions";
import { GET as calendarFeed } from "@/app/api/ics/[token]/route";
import { POST as changeSchedule } from "@/app/api/schedule/route";
import { POST as emailExport } from "@/app/api/export/email/route";
import { getUser, requireOnboardedUser } from "@/lib/auth";
import { mailConfigured } from "@/lib/mail";
import { messages } from "@/i18n/messages";

vi.mock("@/lib/auth", { spy: true });
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/i18n/server", () => ({ getT: () => messages.en }));

// A private in-memory database with the real migrations and seed data.
process.env.DATABASE_PATH = ":memory:";

let user: User;

async function subscribedEvents() {
  const token = user.feedToken + ".ics";
  const response = await calendarFeed(new Request("https://poli.example.org/api/ics/" + token), { params: Promise.resolve({ token }) });
  expect(response.status).toBe(200);
  const body = (await response.text()).replace(/\r\n /g, "");
  const parts = body.split("BEGIN:VEVENT\r\n").slice(1);
  const events = new Map(parts.map(part => {
    const event = part.split("END:VEVENT")[0];
    const uid = /^UID:(.+?)\r$/m.exec(event)![1];
    return [uid, event] as const;
  }));
  expect(events.size).toBe(parts.length);
  return events;
}

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

describe("URL subscriptions", () => {
  const sequence = (event: string) => Number(/^SEQUENCE:(\d+)\r$/m.exec(event)?.[1] ?? 0);
  const change = (body: Record<string, unknown>) => changeSchedule(new Request("https://poli.example.org/api/schedule", {
    method: "POST", body: JSON.stringify(body),
  }));
  beforeEach(() => { vi.mocked(getUser).mockResolvedValue(user); });
  afterEach(() => { vi.mocked(getUser).mockReset(); });

  it("publishes a weekly class on its new weekday and marks the same event as revised for subscribers", async () => {
    const entry = getDb().select().from(entries).where(eq(entries.key, "ac-mate-curs")).get()!;
    const uid = `entry-${entry.id}@upt-orar`;
    const original = await subscribedEvents();
    const before = original.get(uid)!;
    expect(before).toContain("DTSTART;TZID=Europe/Bucharest:20260928T080000");
    expect(before).toMatch(/^RRULE:FREQ=WEEKLY;.*BYDAY=MO\r$/m);
    expect(sequence(before)).toBeGreaterThan(0);
    try {
      expect((await change({ action: "move", entryId: entry.id, day: 4, startMin: 600, endMin: 720 })).ok).toBe(true);
      const moved = await subscribedEvents();
      const series = moved.get(uid)!;
      expect(series).toContain("DTSTART;TZID=Europe/Bucharest:20261001T100000");
      expect(series).toMatch(/^RRULE:FREQ=WEEKLY;.*BYDAY=TH\r$/m);
      expect(series).not.toContain("20260928T080000");
      expect(moved.size).toBe(original.size);
      expect(sequence(series)).toBeGreaterThan(sequence(before));
      expect(series).toMatch(/^LAST-MODIFIED:\d{8}T\d{6}Z\r$/m);
      for (const [key, text] of original) if (key !== uid) expect(moved.get(key)).toBe(text);

      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(Date.now() + 120_000);
      expect(await subscribedEvents()).toEqual(moved);
      expect((await change({ action: "reset", entryId: entry.id })).ok).toBe(true);
      const restored = (await subscribedEvents()).get(uid)!;
      expect(restored).toContain("DTSTART;TZID=Europe/Bucharest:20260928T080000");
      expect(sequence(restored)).toBeGreaterThan(sequence(series));
    } finally {
      vi.useRealTimers();
      await change({ action: "reset", entryId: entry.id });
    }
  });

  it("revises a restored class even when it returns with identical hours", async () => {
    const entry = getDb().select().from(entries).where(eq(entries.key, "ac-mate-lab")).get()!;
    const uid = `entry-${entry.id}@upt-orar`;
    const before = (await subscribedEvents()).get(uid)!;
    try {
      expect((await change({ action: "hide", entryId: entry.id })).ok).toBe(true);
      expect((await subscribedEvents()).has(uid)).toBe(false);
    } finally {
      expect((await change({ action: "reset", entryId: entry.id })).ok).toBe(true);
    }
    const after = (await subscribedEvents()).get(uid)!;
    expect(after).toContain("DTSTART;TZID=Europe/Bucharest:20260928T080000");
    expect(sequence(after)).toBe(sequence(before) + 1);
  });
});

describe("calendar email delivery", () => {
  const deliver = vi.fn<typeof fetch>();
  let account: User;

  beforeEach(() => {
    vi.stubEnv("SMTP_HOST", "");
    vi.stubEnv("RESEND_API_KEY", "test-sending-key");
    vi.stubEnv("VERIFICATION_EMAIL_FROM", "Poli <sender@example.org>");
    vi.stubEnv("APP_URL", "https://poli.example.org");
    vi.stubGlobal("fetch", deliver.mockReset().mockResolvedValue(Response.json({ id: "test-message" })));
    account = getDb().update(users).set({ locale: "ro", exportEmail: null, calendarEmailedAt: null })
      .where(eq(users.id, user.id)).returning().get();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("enables the settings form and delivers its Romanian calendar attachment with only Resend configured", async () => {
    expect(mailConfigured("calendar")).toBe(true);
    vi.mocked(getUser).mockResolvedValueOnce(account);
    const response = await emailExport(new Request("https://poli.example.org/api/export/email", {
      method: "POST", body: JSON.stringify({ email: "friend@example.org" }),
    }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ sentTo: "friend@example.org" });
    const [url, request] = deliver.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(request?.headers).toMatchObject({ Authorization: "Bearer test-sending-key", "Idempotency-Key": expect.stringMatching(/^calendar\//) });
    const message = JSON.parse(String(request?.body));
    expect(message).toMatchObject({ from: "Poli <sender@example.org>", to: "friend@example.org", subject: messages.ro.settings.mail.subject });
    expect(message.text).not.toContain("/api/ics/");
    expect(message.attachments).toHaveLength(1);
    expect(message.attachments[0]).toMatchObject({ filename: "poli.ics", content_type: "text/calendar" });
    const ics = Buffer.from(message.attachments[0].content, "base64").toString("utf8");
    expect(ics).toContain("BEGIN:VCALENDAR\r\n");
    expect(ics).toContain("Matematică (Curs)");
    expect(ics).toContain("END:VCALENDAR");
    expect(await emailCalendar(account)).toMatchObject({ ok: false, status: 429 });
    expect(deliver).toHaveBeenCalledTimes(1);
  });

  it("releases a failed HTTPS send and includes the private link on a successful retry to the owner", async () => {
    deliver.mockResolvedValueOnce(new Response(null, { status: 503 }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await emailCalendar(account, "friend@example.org")).toMatchObject({ ok: false, status: 502 });
    expect(getDb().select().from(users).where(eq(users.id, account.id)).get())
      .toMatchObject({ exportEmail: null, calendarEmailedAt: null });
    expect(await emailCalendar(account)).toEqual({ ok: true, sentTo: account.email });
    const message = JSON.parse(String(deliver.mock.calls[1][1]?.body));
    expect(message.text).toContain("https://poli.example.org/api/ics/" + account.feedToken + ".ics");
  });

  it("keeps an explicitly configured SMTP calendar sender when both providers are available", async () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.org");
    vi.stubEnv("SMTP_USER", "calendar@example.org");
    vi.stubEnv("SMTP_PASS", "test-password");
    const transport = nodemailer.createTransport({ jsonTransport: true });
    const send = vi.spyOn(transport, "sendMail");
    vi.spyOn(nodemailer, "createTransport").mockReturnValue(transport);
    expect(await emailCalendar(account)).toEqual({ ok: true, sentTo: account.email });
    expect(send).toHaveBeenCalledOnce();
    expect(deliver).not.toHaveBeenCalled();
  });
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

  it("names the sitting in the title of a distance-learning exam", () => {
    // Each sitting is published as an exam of its own. In a phone's calendar all three were
    // "Examen: Limbaje de programare 1", and so were its reminders, on three dates.
    const db = getDb();
    const added = [1, 2].map((n) => {
      const exam = db.insert(exams).values({ key: `id-lp1-${n}`, facultyId: user.facultyId!, courseName: "Limbaje de programare 1", date: `2027-01-2${n}`,
        startMin: 600, endMin: 600, room: null, year: 1, rawText: "x", audience: `Examen_LP1_TST ID_Anul l_Prezentarea ${n}` }).returning().get();
      db.insert(examSpecializations).values({ examId: exam.id, specializationId: user.specializationId! }).run();
      return exam.id;
    });
    try {
      const titles = exportItems({ ...user, locale: "ro" }).map((i) => i.title);
      expect(titles).toEqual(expect.arrayContaining(["Examen: Limbaje de programare 1 (Prezentarea 1)", "Examen: Limbaje de programare 1 (Prezentarea 2)", "Examen: Matematică · A204"]));
      expect(exportItems(user, "en").map((i) => i.title)).toContain("Exam: Limbaje de programare 1 (Sitting 2 of the exam)");
    } finally {
      for (const id of added) db.delete(exams).where(eq(exams.id, id)).run();
    }
  });

  it("names the feed Poli and keeps existing event identities", () => {
    const [item] = exportItems(user);
    const feed = toICS([item]);
    expect(feed).toContain("X-WR-CALNAME:Poli");
    expect(feed).toContain(`UID:${item.uid}@upt-orar`);
  });

  it.each(["UPT Orar", "My lectures"])("reuses a connected Google calendar named %s", async (summary) => {
    const updates: unknown[] = [];
    const alarms = new Map<string, unknown>();
    const fake = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("oauth2.googleapis.com")) return Response.json({ access_token: "test" });
      if (url.endsWith("/calendars/connected") && init?.method === "GET") return Response.json({ summary });
      if (url.endsWith("/calendars/connected") && init?.method === "PATCH") {
        updates.push(JSON.parse(String(init.body)));
        return Response.json({ id: "connected" });
      }
      if (url.includes("/calendars/connected/events")) {
        if (init?.method === "POST") {
          const event = JSON.parse(String(init.body));
          alarms.set(event.extendedProperties.private.uptOrar, event.reminders);
          return Response.json({ ...event, etag: '"v1"' });
        }
        return Response.json({ items: [], nextSyncToken: "v1" });
      }
      throw new Error("Unexpected Google Calendar endpoint");
    });
    vi.stubGlobal("fetch", fake);
    try {
      getDb().update(users).set({ googleRefreshToken: "test", googleCalendarId: "connected" }).where(eq(users.id, user.id)).run();
      const result = await syncToGoogle(user);
      expect(result.calendarId).toBe("connected");
      expect(updates).toEqual(summary === "UPT Orar" ? [{ summary: "Poli" }] : []);
      expect([...alarms.keys()]).toEqual(expect.arrayContaining([expect.stringMatching(/^exam-/), expect.stringMatching(/^entry-/)]));
      for (const [uid, reminders] of alarms) {
        const minutes = uid.startsWith("exam-") ? [1440, 120] : [15];
        expect(reminders).toEqual({ useDefault: false, overrides: minutes.map((m) => ({ method: "popup", minutes: m })) });
      }
    } finally {
      vi.unstubAllGlobals();
    }
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
    { to: " ALTERNATE@example.com ", rememberAddress: false, includesFeed: false, saved: "alternate@example.com" },
    { to: " S@example.com ", rememberAddress: false, includesFeed: true, saved: "alternate@example.com" },
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
