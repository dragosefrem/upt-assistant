import { createElement } from "react";
import { jsx } from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/events/route";
import { POST as planStudy, DELETE as removeStudy } from "@/app/api/study-plan/route";
import { Calendar } from "@/components/Calendar";
import { StudyPlanCard } from "@/components/StudyPlanCard";
import { WeekLabs } from "@/components/WeekLabs";
import { getDb } from "@/db";
import { exams, examSpecializations, faculties, groups, personalEvents, specializations, users } from "@/db/schema";
import { LocaleProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { messages } from "@/i18n/messages";
import { getLocale, getT } from "@/i18n/server";
import { getUser, type User } from "@/lib/auth";
import { studyBlocks } from "@/lib/study-plan";

vi.mock("@/lib/auth", async (load) => ({ ...(await load<typeof import("@/lib/auth")>()), getUser: vi.fn() }));
vi.mock("@/i18n/server", async (load) => ({ ...(await load<typeof import("@/i18n/server")>()), getT: vi.fn(), getLocale: vi.fn() }));

const from = "2026-11-30";
const to = "2026-12-06";
let user: User;

beforeAll(() => {
  vi.stubEnv("DATABASE_PATH", ":memory:");
  const db = getDb();
  const faculty = db.insert(faculties).values({ name: "Engineering", slug: "eng" }).returning().get();
  const spec = db.insert(specializations).values({ name: "Software", slug: "sw", degree: "bachelor", facultyId: faculty.id }).returning().get();
  const group = db.insert(groups).values({ specializationId: spec.id, year: 1, name: "1.1" }).returning().get();
  user = db.insert(users).values({ id: "calendar", name: "Ana", email: "ana@example.org", locale: "ro", passwordHash: "test", feedToken: "calendar",
    groupId: group.id, specializationId: spec.id, facultyId: faculty.id, year: 1 }).returning().get();
  db.insert(personalEvents).values({ userId: user.id, title: "Lunch", date: from, startMin: 720, endMin: 750 }).run();
  for (const date of ["2027-01-27", "2027-02-10"]) {
    const exam = db.insert(exams).values({ key: date, facultyId: faculty.id, courseName: "Fizică", date, year: 1,
      startMin: 540, endMin: 660, rawText: "Fizică" }).returning().get();
    db.insert(examSpecializations).values({ examId: exam.id, specializationId: spec.id }).run();
  }
  vi.mocked(getUser).mockResolvedValue(user);
});

it("saves one plan for both sittings in the current interface language and can remove it after exams end", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-11-21T10:00:00Z"));
    vi.mocked(getLocale).mockResolvedValue("en");
    vi.mocked(getT).mockResolvedValue(messages.en);
    const request = new Request("http://localhost/api/study-plan", { method: "POST", body: JSON.stringify({ hoursPerExam: 6, save: true }) });
    const data = await (await planStudy(request)).json();
    expect(data.exams).toHaveLength(1);
    expect(data.exams[0]).toMatchObject({ date: "2027-01-27", alsoOn: ["2027-02-10"] });
    expect(studyBlocks(user.id).map((block) => block.title)).toEqual(expect.arrayContaining(["Study: Fizică (1/3)", "Final review: Fizică"]));

    vi.setSystemTime(new Date("2027-03-01T10:00:00Z"));
    const card = createElement(StudyPlanCard, { examCount: 0, savedBlocks: data.saved });
    expect(renderToStaticMarkup(jsx(LocaleProvider, { locale: "en", children: card }))).toContain(messages.en.study.plan.card.clear);
    expect(await (await removeStudy()).json()).toEqual({ removed: 3 });
    expect(studyBlocks(user.id)).toHaveLength(0);
  } finally {
    vi.useRealTimers();
  }
});
afterAll(() => vi.unstubAllEnvs());

describe("public holidays in the calendar", () => {
  it.each([
    ["ro", "Sfântul Andrei", "Ziua Națională a României"],
    ["en", "Saint Andrew’s Day", "National Day of Romania"],
  ] as const)("uses %s names in the API, the first calendar render and a week with no practicals", async (locale: Locale, monday, tuesday) => {
    vi.mocked(getLocale).mockResolvedValue(locale);
    vi.mocked(getT).mockResolvedValue(messages[locale]);
    const data = await (await GET(new Request(`http://localhost/api/events?from=${from}&to=${to}`))).json();
    expect(data.holidays).toEqual([{ date: from, name: monday }, { date: "2026-12-01", name: tuesday }]);
    expect(data.events.map((e: { title: string }) => e.title)).toEqual(["Lunch"]);
    const calendar = createElement(Calendar, {
      initialEvents: data.events, initialHolidays: data.holidays, initialFrom: from, initialTo: to,
      initialWeek: data.teachingWeek, today: from, hasGroup: true,
    });
    for (const component of [calendar, createElement(WeekLabs, { user, date: from, locale })]) {
      const html = renderToStaticMarkup(jsx(LocaleProvider, { locale, children: component }));
      expect(html).toContain(monday);
      expect(html).toContain(tuesday);
    }
    expect((await GET(new Request("http://localhost/api/events?from=2026-11-31"))).status).toBe(400);
  });
});
