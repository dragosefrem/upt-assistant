import { load as loadHtml } from "cheerio";
import { eq } from "drizzle-orm";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/assistant/route";
import { POST as review } from "@/app/api/assistant/preview/route";
import { POST as accept } from "@/app/api/assistant/accept/route";
import { AssistantReplyCard } from "@/components/AssistantReplyCard";
import { getDb } from "@/db";
import { chatMessages, courses, entries, entryGroups, exams, examSpecializations, faculties, groups, personalEvents, semesters, specializations, users, userOverrides } from "@/db/schema";
import { messages } from "@/i18n/messages";
import { LocaleProvider } from "@/i18n/client";
import { getLocale, getT } from "@/i18n/server";
import { historyFor } from "@/lib/assistant/gemini";
import { parseChoices } from "@/lib/assistant/choices";
import { cardForLookup, parseReplyCard, type ReplyCard } from "@/lib/assistant/reply-card";
import { getUser, type User } from "@/lib/auth";
import { eventsBetween } from "@/lib/schedule";

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

const action = (route: typeof review, body: unknown) => route(new Request("http://localhost", { method: "POST", body: JSON.stringify(body) }));

function classFixture() {
  const db = getDb();
  const semester = db.select().from(semesters).where(eq(semesters.isCurrent, true)).get()!;
  const course = db.insert(courses).values({ semesterId: semester.id, facultyId: student.facultyId!, key: "studio", name: "Studio", year: 1 }).returning().get();
  const entry = db.insert(entries).values({ key: "weekly-studio", semesterId: semester.id, courseId: course.id, kind: "lab", day: 4,
    startMin: 600, endMin: 660, room: "B2", rawText: "Studio" }).returning().get();
  db.insert(entryGroups).values({ entryId: entry.id, groupId: student.groupId! }).run();
  return { entry, remove: () => db.delete(courses).where(eq(courses.id, course.id)).run() };
}

describe("Choosing and reviewing times in Poli chat", () => {
  it("selects the right occurrence with a duplicate title, previews a clash, switches to a free time, and saves once", async () => {
    const db = getDb();
    const [a, b] = db.insert(personalEvents).values([660, 800].map((startMin) => ({
      userId: student.id, title: "Tutoring", date: day, startMin, endMin: startMin + 30,
    }))).returning().all();
    const read = (id: number) => db.select().from(personalEvents).where(eq(personalEvents.id, id)).get();
    try {
      const { card, done } = await ask("Move my tutoring to tomorrow at 14:00");
      if (card?.type !== "move") throw new Error("Expected a move picker");
      expect(card.events.map((e) => e.start)).toEqual(["11:00", "13:20"]);
      expect(card.proposed).toMatchObject({ date: "2026-11-24", start: "14:00" });
      const edit = { id: done.messageId, occurrence: card.events[1].move.occurrence, date: "2026-11-24", start: "14:00", end: "14:30" };
      vi.mocked(getUser).mockResolvedValue(other);
      expect((await action(review, edit)).status).toBe(409);
      vi.mocked(getUser).mockResolvedValue(student);
      expect((await action(review, { ...edit, occurrence: "p:999:2026-11-23" })).status).toBe(409);
      expect((await action(review, { ...edit, end: "13:00" })).status).toBe(400);
      const first = await (await action(review, edit)).json();
      expect(first.preview).toMatchObject({ from: { date: day, start: "13:20", end: "13:50" }, events: [{ title: "Project meeting", overlaps: true }] });
      expect(first.preview.change).toBeUndefined();
      expect(first.preview.alternatives).toHaveLength(2);
      const slot = first.preview.alternatives[0];
      const second = await (await action(review, { id: first.id, date: edit.date, ...slot })).json();
      expect(second.preview).toMatchObject({ start: slot.start, end: slot.end, events: [{ overlaps: false }] });
      expect(read(b.id)?.startMin).toBe(800);
      expect((await action(accept, { id: first.id })).status).toBe(409);
      const { done: saved } = await ask("Yes, move it", true);
      expect(saved).toMatchObject({ changed: true, acceptedId: second.id });
      expect(slot).toEqual({ start: "13:30", end: "14:00" });
      expect(read(b.id)).toMatchObject({ date: edit.date, startMin: 810, endMin: 840 });
      expect(read(a.id)).toMatchObject({ date: day, startMin: 660 });
      const history = (await (await GET()).json()).messages;
      expect(history.find((m: { id: number }) => m.id === second.id).preview.status).toBe("accepted");
      expect((await action(accept, { id: second.id })).status).toBe(409);
    } finally {
      db.delete(personalEvents).where(eq(personalEvents.title, "Tutoring")).run();
    }
  });

  it("offers a move on a timetable row and requires a fresh review when another event arrives", async () => {
    const { card, done } = await ask("What do I have today?");
    if (card?.type !== "schedule") throw new Error("Expected a timetable");
    const row = card.events.find((e) => e.title === "Lunch")!;
    const edit = { date: day, start: "16:30", end: "17:30" };
    const draft = await (await action(review, { id: done.messageId, occurrence: row.move!.occurrence, ...edit })).json();
    const db = getDb();
    const blocker = db.insert(personalEvents).values({ userId: student.id, title: "New booking", date: day, startMin: 1000, endMin: 1020 }).returning().get();
    try {
      const response = await action(accept, { id: draft.id });
      expect(response.status).toBe(409);
      expect((await response.json()).error).toBe(messages.en.assistant.accept.newConflict);
      const refreshed = await (await action(review, { id: draft.id, ...edit })).json();
      expect(refreshed.preview.events).toContainEqual(expect.objectContaining({ title: blocker.title, overlaps: true }));
      expect(db.select().from(personalEvents).where(eq(personalEvents.title, "Lunch")).get()?.startMin).toBe(720);
    } finally { db.delete(personalEvents).where(eq(personalEvents.id, blocker.id)).run(); }
  });

  it("rejects a moved source, old messages, and signed-out review requests", async () => {
    const { card, done } = await ask("Mută un eveniment de luni");
    if (card?.type !== "move") throw new Error("Expected a move picker");
    const row = card.events.find((e) => e.title === "Lunch")!;
    const edit = { date: day, start: "18:00", end: "19:00" };
    const draft = await (await action(review, { id: done.messageId, occurrence: row.move.occurrence, ...edit })).json();
    const db = getDb();
    const lunch = eq(personalEvents.title, "Lunch");
    try {
      db.update(personalEvents).set({ startMin: 730 }).where(lunch).run();
      expect((await action(accept, { id: draft.id })).status).toBe(409);
      expect((await action(review, { id: draft.id, ...edit })).status).toBe(409);
      expect((await action(review, { id: done.messageId, occurrence: row.move.occurrence, ...edit })).status).toBe(409);
      vi.mocked(getUser).mockResolvedValue(null);
      expect((await action(review, { id: draft.id, ...edit })).status).toBe(401);
    } finally { db.update(personalEvents).set({ startMin: 720 }).where(lunch).run(); }
  });

  it("offers concrete choices in both languages and keeps choosing separate from confirming a change", async () => {
    const fixture = classFixture();
    getDb().insert(userOverrides).values({ userId: student.id, entryId: fixture.entry.id, hidden: true }).run();
    try {
      expect((await ask("Restore all classes")).done.choices).toEqual([{ label: "Restore all", reply: "Yes" }, { label: "Keep my timetable", reply: "No" }]);
      expect((await ask("No")).text).toBe(messages.en.assistant.basic.kept);
      expect((await ask("Restaurează tot")).done.choices[0]).toEqual({ label: "Restabilește tot", reply: "Da" });
      expect((await ask("Nu")).done.changed).toBe(false);
      expect((await ask("Move my exam to Tuesday")).card).toBeUndefined();
      expect((await ask("Move my lunch to 2026-02-30")).text).toBe(messages.en.assistant.basic.invalidDate);
      expect(parseChoices('[{"label":"Same day","reply":"Yes","date":"invalid"}]')).toEqual([{ label: "Same day", reply: "Yes" }]);
    } finally { fixture.remove(); }
  });

  it.each([false, true])("moves exactly the chosen class scope (whole series = %s)", async (weekly) => {
    const fixture = classFixture();
    try {
      const { card, done } = await ask("Move my Studio lab on Thursday");
      if (card?.type !== "move") throw new Error("Expected the class picker");
      expect(card.events[0].move.scope).toBe("choose");
      const input = { id: done.messageId, occurrence: card.events[0].move.occurrence, start: "11:15", end: "12:15" };
      expect((await action(review, { ...input, date: "2026-12-01" })).status).toBe(422);
      const draft = await (await action(review, { ...input, date: "2026-11-27", weekly })).json();
      expect(draft.preview).toMatchObject({ weekly, from: { date: "2026-11-26" }, date: "2026-11-27", start: "11:15" });
      expect((await action(accept, { id: draft.id })).status).toBe(200);
      const classes = eventsBetween(student, "2026-11-23", "2026-12-06").filter((e) => e.entryId === fixture.entry.id);
      expect(classes.map((e) => [e.date, e.startMin])).toEqual([["2026-11-27", 675], [weekly ? "2026-12-04" : "2026-12-03", weekly ? 675 : 600]]);
    } finally { fixture.remove(); }
  });

  it("keeps a personal series weekly and checks the following week's conflicts and alternatives", async () => {
    const db = getDb();
    const [series, clash] = db.insert(personalEvents).values([
      { userId: student.id, title: "Weekly swim", day: 3, startMin: 600, endMin: 645 },
      { userId: student.id, title: "Pool maintenance", date: "2026-12-03", startMin: 690, endMin: 735 },
    ]).returning().all();
    try {
      const { card, done } = await ask("Move my weekly swim on Wednesday");
      if (card?.type !== "move") throw new Error("Expected the move picker");
      expect(card.events[0].move.scope).toBe("series");
      const draft = await (await action(review, { id: done.messageId, occurrence: card.events[0].move.occurrence,
        date: "2026-11-26", start: "11:30", end: "12:15" })).json();
      expect(draft.preview.events.some((e: { overlaps: boolean }) => e.overlaps)).toBe(false);
      expect(draft.preview.otherClashes).toEqual([{ title: clash.title, date: clash.date, start: "11:30", end: "12:15" }]);
      expect(draft.preview.alternatives).toEqual([{ start: "10:45", end: "11:30" }, { start: "12:15", end: "13:00" }]);
      const revised = await (await action(review, { id: draft.id, date: draft.preview.date, ...draft.preview.alternatives[0] })).json();
      expect((await action(accept, { id: revised.id })).status).toBe(200);
      expect(db.select().from(personalEvents).where(eq(personalEvents.id, series.id)).get()).toMatchObject({ date: null, day: 4, startMin: 645, endMin: 690 });
    } finally {
      db.delete(personalEvents).where(eq(personalEvents.id, series.id)).run();
      db.delete(personalEvents).where(eq(personalEvents.id, clash.id)).run();
    }
  });

  it("preserves a Gemini destination when an event name is ambiguous", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    geminiTurn([{ functionCall: { name: "move_personal_event", args: { title: "group", new_start: "18:30" } } }]);
    geminiTurn([{ text: "Which group would you like to move?" }]);
    const db = getDb();
    const otherGroup = db.insert(personalEvents).values({ userId: student.id, title: "Book group", date: day, startMin: 1140, endMin: 1200 }).returning().get();
    try {
      const { card } = await ask("Move my group to 18:30");
      expect(card).toMatchObject({ type: "move", count: 2, proposed: { start: "18:30" } });
      expect(JSON.stringify(card)).not.toContain("Someone else's event");
    } finally { db.delete(personalEvents).where(eq(personalEvents.id, otherGroup.id)).run(); }
  });

  it("understands a spoken ordinal and reviews the selected event at the requested time", async () => {
    const db = getDb();
    const second = db.insert(personalEvents).values({ userId: student.id, title: "Lunch", date: day, startMin: 800, endMin: 830 }).returning().get();
    try {
      const { done } = await ask("Mută Lunch de luni pe marți la 15:30", true);
      expect(done.card.events).toHaveLength(2);
      const picked = await ask("A doua", true);
      expect(picked.done.preview).toMatchObject({ date: "2026-11-24", start: "15:30", end: "16:00", from: { date: day, start: "13:20" } });
      expect(db.select().from(personalEvents).where(eq(personalEvents.id, second.id)).get()?.startMin).toBe(800);
      const history = (await (await GET()).json()).messages;
      expect(history.at(-2).content).toBe("A doua");
    } finally { db.delete(personalEvents).where(eq(personalEvents.id, second.id)).run(); }
  });

  it("reviews a complete request directly and binds tapped answers to their original question", async () => {
    const { done } = await ask("Reschedule lunch to tomorrow at 14:00");
    expect(done.preview).toMatchObject({ title: "Lunch", date: "2026-11-24", start: "14:00", end: "15:00" });
    const invalid = await action(POST, { message: "Yes", choiceMessageId: done.messageId });
    expect(invalid.status).toBe(409);
    expect((await (await GET()).json()).messages).toHaveLength(2);
    const pick = await ask("Move an event");
    expect(pick.card?.type).toBe("move");
    const selected = await ask("the second one", true);
    expect(selected.card).toMatchObject({ type: "move", count: 1, events: [{ title: "Lunch" }] });
  });

  it("requires the same reviewed change for a model-assisted confirmation", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    const db = getDb();
    const title = "Chess practice";
    const args = { title, date: day, start: "18:00", end: "19:00", confirmed: true };
    const turn = (start: string) => {
      geminiTurn([{ functionCall: { name: "add_personal_event", args: { ...args, start } } }]);
      geminiTurn([{ text: "Chess practice at the selected time." }]);
    };
    try {
      turn("18:00");
      expect((await ask("Add chess practice")).done).toMatchObject({ changed: false, preview: { start: "18:00" } });
      turn("18:30");
      const changedTime = await ask("Actually, half an hour later");
      expect(changedTime.done).toMatchObject({ changed: false, preview: { start: "18:30" } });
      expect(db.select().from(personalEvents).where(eq(personalEvents.title, title)).all()).toHaveLength(0);
      turn("18:30");
      expect((await ask("That looks perfect, go ahead")).done).toMatchObject({ changed: true, acceptedId: changedTime.done.messageId });
      expect(db.select().from(personalEvents).where(eq(personalEvents.title, title)).all()).toHaveLength(1);
      const history = (await (await GET()).json()).messages;
      expect(history).toHaveLength(6);
      expect(history[3].preview.status).toBe("accepted");
    } finally { db.delete(personalEvents).where(eq(personalEvents.title, title)).run(); }
  });
});

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

  it("keeps the timetable card when the same question also asks for something without a card", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    // "What do I have today, and what does semigrupă mean?": a timetable, then a supporting fact.
    geminiTurn([{ functionCall: { name: "get_schedule", args: { from: day } } }]);
    geminiTurn([{ functionCall: { name: "explain_term", args: { term: "semigrupă" } } }]);
    geminiTurn([{ text: "You have three things today, listed below. A semigrupă is half of a group." }]);
    const { card, text } = await ask("What do I have today, and what does semigrupă mean?");
    expect(text).toContain("listed below");
    // The reply points at the list: it has to be there.
    if (card?.type !== "schedule") throw new Error("Expected the timetable card to survive the second lookup");
    expect(card.events.map((e) => e.title)).toEqual(["Reading group", "Lunch", "Design review"]);
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

  it("finishes and saves the answer when the page is reloaded while Poli is still writing it", async () => {
    vi.stubEnv("GEMINI_API_KEY", "test");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    let answer!: () => void;
    const thinking = new Promise<void>((resolve) => { answer = resolve; });
    generate.mockImplementationOnce(async () => {
      await thinking;
      return { candidates: [{ content: { role: "model", parts: [{ functionCall: { name: "get_schedule", args: { from: day } } }] }, finishReason: "STOP" }] };
    });
    geminiTurn([{ text: "Your day starts with the reading group at 10." }]);
    try {
      const res = await POST(new Request("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ message: "What do I have today?" }) }));
      // The student reloads: the browser stops reading the answer.
      await res.body!.cancel();
      const saved = () => getDb().select().from(chatMessages).all();
      // The reopened conversation is told which question is still being answered, and a second
      // question is not started on top of it: that answered the first one twice, out of order.
      const question = saved()[0].id;
      expect((await (await GET()).json()).answering).toBe(question);
      const second = await POST(new Request("http://localhost/api/assistant", { method: "POST", body: JSON.stringify({ message: "And on Friday?" }) }));
      expect(second.status).toBe(409);
      expect(await second.json()).toMatchObject({ answering: question, error: messages.en.assistant.api.stillAnswering });
      expect(saved().map((m) => m.content)).toEqual(["What do I have today?"]);
      expect(generate).toHaveBeenCalledTimes(1);
      answer();
      await vi.waitFor(() => expect(saved().map((m) => m.role)).toEqual(["user", "assistant"]));
      // The turn was not thrown away, not answered a second time by the built-in assistant,
      // and not reported as a failure of the model.
      expect(saved()[1].content).toBe("Your day starts with the reading group at 10.");
      expect(parseReplyCard(saved()[1].card)?.type).toBe("schedule");
      expect(log).not.toHaveBeenCalled();
      // Back on the page, the conversation has the answer.
      const history = await (await GET()).json();
      expect(history.messages.at(-1)).toMatchObject({ role: "assistant", content: "Your day starts with the reading group at 10." });
      // Nothing is being answered any more, and the next question goes through.
      await vi.waitFor(async () => expect((await (await GET()).json()).answering).toBeNull());
      geminiTurn([{ text: "Nothing on Friday." }]);
      expect((await ask("And on Friday?")).text).toBe("Nothing on Friday.");
    } finally {
      log.mockRestore();
    }
  });
});
