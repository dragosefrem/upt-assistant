import { load as loadHtml } from "cheerio";
import { eq } from "drizzle-orm";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/assistant/route";
import { AssistantReplyCard } from "@/components/AssistantReplyCard";
import { getDb } from "@/db";
import { chatMessages, exams, examSpecializations, faculties, groups, personalEvents, specializations, users } from "@/db/schema";
import { messages } from "@/i18n/messages";
import { LocaleProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import { historyFor } from "@/lib/assistant/gemini";
import { cardForLookup, parseReplyCard, type ReplyCard } from "@/lib/assistant/reply-card";
import { getUser, type User } from "@/lib/auth";

vi.mock("@/lib/auth", async (load) => ({ ...(await load<typeof import("@/lib/auth")>()), getUser: vi.fn() }));
vi.mock("@/i18n/server", async (load) => ({ ...(await load<typeof import("@/i18n/server")>()), getLocale: vi.fn(), getT: vi.fn() }));
const generate = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", async (load) => ({
  ...(await load<typeof import("@google/genai")>()),
  GoogleGenAI: class { models = { generateContent: generate }; },
}));

const day = "2026-11-23";
let student: User;
let other: User;

beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-23T08:15:00Z")); // 10:15 on Monday
  vi.stubEnv("DATABASE_PATH", ":memory:");
  const db = getDb();
  const faculty = db.insert(faculties).values({ name: "Engineering", slug: "ac", shortName: "AC" }).returning().get();
  const spec = db.insert(specializations).values({ facultyId: faculty.id, degree: "bachelor", name: "Computing", slug: "comp" }).returning().get();
  const group = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "1.1" }).returning().get();
  const profile = { name: "Student", passwordHash: "test", facultyId: faculty.id, specializationId: spec.id, year: 1, groupId: group.id };
  [student, other] = db.insert(users).values(["first", "second"].map((id) => ({ ...profile, id, email: `${id}@example.org`, feedToken: id }))).returning().all();
  db.insert(personalEvents).values([
    { userId: student.id, date: day, startMin: 600, endMin: 660, title: "Reading group" },
    { userId: student.id, date: day, startMin: 720, endMin: 780, title: "Lunch" },
    { userId: student.id, date: day, startMin: 900, endMin: 990, title: "Design review" },
    { userId: student.id, date: "2026-11-24", startMin: 840, endMin: 900, title: "Project meeting" },
    { userId: other.id, date: day, startMin: 480, endMin: 1200, title: "Someone else's event" },
  ]).run();
  for (const [date, title] of [["2026-11-05", "Past exam"], ["2026-12-08", "Algorithms"], ["2026-12-09", "Databases"]]) {
    const exam = db.insert(exams).values({ key: date, facultyId: faculty.id, year: 1, courseName: title, date,
      startMin: 540, endMin: 540, room: "B419", audience: "1.1", rawText: title }).returning().get();
    db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec.id }).run();
  }
});

beforeEach(() => {
  vi.stubEnv("GEMINI_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.mocked(getUser).mockResolvedValue(student);
  vi.mocked(getLocale).mockResolvedValue("en");
  vi.mocked(getT).mockResolvedValue(messages.en);
  generate.mockReset();
  getDb().delete(chatMessages).run();
});

afterAll(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

async function ask(message: string, spoken = false) {
  const res = await POST(new Request("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ message, spoken }) }));
  expect(res.status).toBe(200);
  const chunks = (await res.text()).trim().split("\n").map((line) => JSON.parse(line));
  const done = chunks.at(-1);
  expect(done.type).toBe("done");
  return { done, card: done.card as ReplyCard | undefined, text: chunks.filter((c) => c.type === "text").map((c) => c.text).join(" ") };
}

function geminiTurn(parts: unknown[]) {
  generate.mockResolvedValueOnce({ candidates: [{ content: { role: "model", parts }, finishReason: "STOP" }] });
}

describe("Poli reply cards", () => {
  it.each([
    ["Ce am mâine?", { type: "schedule", count: 1, events: [{ title: "Project meeting", start: "14:00" }] }, "Project meeting"],
    ["What's next?", { type: "next", current: { title: "Reading group" }, next: { title: "Lunch" }, now: day + " 10:15" }, "12:00"],
    ["Where is my next exam?", { type: "exams", count: 1, exams: [{ course: "Algorithms", room: "B419", end: null }] }, "B419"],
    ["Ce examene am pe 2026-12-09?", { type: "exams", count: 1, exams: [{ course: "Databases" }] }, "Databases"],
    ["Do I have an exam on 2026-12-08?", { type: "exams", count: 1, exams: [{ course: "Algorithms" }] }, "Algorithms"],
    ["Când sunt liber luni?", { type: "free", for: "you", count: 4 }, "11:00–12:00"],
    ["Show my timetable this week", { type: "schedule", from: day, to: "2026-11-29", count: 4 }, "Project meeting"],
    ["When am I free next week?", { type: "free", from: "2026-11-30", to: "2026-12-06" }, "08:00"],
  ])("returns a grounded card and a speakable answer for %s", async (prompt, expected, detail) => {
    const { card, text } = await ask(prompt, true);
    expect(card).toMatchObject({ ...expected, textIsTranscript: true });
    expect(text).toContain(detail);
    expect(text).not.toContain("–null");
    expect(JSON.stringify(card)).not.toMatch(/personal_event_id|Someone else's event/);
    const history = await (await GET()).json();
    expect(history.messages.at(-1)).toMatchObject({ content: text, card });
  });

  it.each(["What does semigrupă mean?", "Ce am pe 2026-11-29?", "Ce am pe 2026-02-30?", "When am I free on Sunday?", "Which exams are next week?"])(
    "keeps a text-only answer for %s", async (prompt) => {
      await ask("What's next?");
      const { card, text } = await ask(prompt);
      expect(card).toBeUndefined();
      expect(text.length).toBeGreaterThan(10);
    },
  );

  it("round-trips snapshots alongside old or malformed messages and scopes history and clearing to the student", async () => {
    const db = getDb();
    db.insert(chatMessages).values([
      { userId: student.id, role: "assistant", content: "Older answer" },
      { userId: student.id, role: "assistant", content: "Still readable", card: '{"type":"free","free":[{}]}' },
    ]).run();
    const { card } = await ask("When are my exams?");
    db.update(exams).set({ courseName: "Revised" }).where(eq(exams.key, "2026-12-09")).run();
    try {
      const { messages: history } = await (await GET()).json();
      expect(history[0].card).toBeUndefined();
      expect(history[1]).toMatchObject({ content: "Still readable" });
      expect(history[1].card).toBeUndefined();
      expect(history.at(-1).card).toEqual(card);
      vi.mocked(getUser).mockResolvedValue(other);
      expect((await (await GET()).json()).messages).toEqual([]);
      await ask("What's next?");
      vi.mocked(getUser).mockResolvedValue(student);
      await DELETE();
      expect((await (await GET()).json()).messages).toEqual([]);
      vi.mocked(getUser).mockResolvedValue(other);
      expect((await (await GET()).json()).messages).toHaveLength(2);
    } finally {
      db.update(exams).set({ courseName: "Databases" }).where(eq(exams.key, "2026-12-09")).run();
    }
  });

  it("bounds large results and drops invalid dates and unknown card formats", () => {
    const row = { date: day, start: "09:00", end: null, course: "Exam", room: null, building: null, teacher: null, for: null, note: "private" };
    const card = cardForLookup("find_exams", { count: 100, exams: Array(60).fill(row) });
    expect(card?.type === "exams" && card.exams).toHaveLength(40);
    expect(card?.type === "exams" && card.count).toBe(100);
    expect(JSON.stringify(card)).not.toContain("private");
    expect(cardForLookup("find_exams", { exams: [{ ...row, date: "2026-02-30" }] })).toBeUndefined();
    expect(parseReplyCard("{")).toBeUndefined();
    expect(parseReplyCard('{"type":"something-new"}')).toBeUndefined();
    const event = { ...row, title: "Lecture", kind: "course" };
    expect(parseReplyCard(JSON.stringify({ type: "next", now: "24:00", current: event, next: null }))).toBeUndefined();
  });

  it("renders localised details, a route for the actual exam, and planning only for the student's current result", async () => {
    const render = (card: ReplyCard, canPlan = true) => loadHtml(renderToStaticMarkup(jsx(LocaleProvider, {
      locale: "ro", children: jsx(AssistantReplyCard, { card, canPlan, onRead: () => {}, transcript: "Răspuns" }),
    })));
    const { card: exam } = await ask("Where is my next exam?");
    const view = render(exam!);
    expect(view("h3").text()).toBe("Programarea examenelor");
    expect(view("summary").text()).toBe("Citește răspunsul complet");
    const route = new URL(view('a[href^="/campus?"]').attr("href")!, "http://localhost");
    expect(Object.fromEntries(route.searchParams)).toMatchObject({ to: "B419", course: "Algorithms", at: "09:00", date: "2026-12-08" });
    const { card } = await ask("When am I free on Monday?");
    if (card?.type !== "free") throw new Error("Expected the free-time card");
    const slots = render(card);
    expect(slots("li")).toHaveLength(2);
    expect(slots("button[aria-expanded=false]").text()).toBe("Arată încă 2");
    expect(slots("li button")).toHaveLength(1); // The first gap has passed.
    expect(render(card, false)("li button")).toHaveLength(0);
    expect(render({ ...card, for: "Group 1.2" })("li button")).toHaveLength(0);
  });

  it("delivers Gemini's final lookup with its own prose and remembers the items for follow-ups", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    geminiTurn([{ functionCall: { name: "get_schedule", args: { from: day } } }]);
    geminiTurn([{ text: "Your day starts at 10." }]);
    const { done, card, text } = await ask("Show me today.");
    expect(done.engine).toBe("gemini");
    expect(card).toMatchObject({ type: "schedule", count: 3 });
    expect(card?.textIsTranscript).toBeUndefined();
    expect(text).toBe("Your day starts at 10.");
    expect(JSON.stringify(historyFor(student.id, "What about the second one?"))).toContain("Lunch");
  });

  it("leaves background lookups out of clarifications and shows a pending change on its own", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    geminiTurn([{ functionCall: { name: "get_schedule", args: { from: day, show_card: false } } }]);
    geminiTurn([{ text: "Which event did you mean?" }]);
    expect((await ask("Help me change my timetable")).card).toBeUndefined();
    geminiTurn([{ functionCall: { name: "get_schedule", args: { from: day } } }]);
    geminiTurn([{ functionCall: { name: "add_personal_event", args: { title: "Gym", date: day, start: "18:00", end: "19:00" } } }]);
    geminiTurn([{ text: "Does 18:00 work?" }]);
    const { done, card } = await ask("Add gym at six.");
    expect(done.preview).toMatchObject({ status: "pending", title: "Gym" });
    expect(card).toBeUndefined();
  });

  it("keeps the free-time card when Gemini double-checks the timetable in the background", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    geminiTurn([{ functionCall: { name: "find_free_slots", args: { from: day } } }]);
    geminiTurn([{ functionCall: { name: "get_schedule", args: { from: day, show_card: false } } }]);
    geminiTurn([{ text: "You have four gaps on Monday." }]);
    const { card } = await ask("When am I free on Monday?");
    expect(card).toMatchObject({ type: "free", count: 4 });
  });

  it("discards a failed provider's lookup before using the built-in answer", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    geminiTurn([{ functionCall: { name: "find_exams", args: {} } }]);
    generate.mockRejectedValueOnce(new Error("test provider unavailable"));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { done, card, text } = await ask("What does semigrupă mean?");
      expect(done.engine).toBe("basic");
      expect(done.notice).toBeTruthy();
      expect(text).toContain("Semigrupă");
      expect(card).toBeUndefined();
    } finally {
      log.mockRestore();
    }
  });
});
