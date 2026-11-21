import { describe, expect, it } from "vitest";
import { roCount } from "@/lib/landing-format";
import { countdown, everydayTip, EVERYDAY_TIPS, examHeadline, examStage, examTips, whereTo } from "@/lib/examTips";
import { toICS } from "@/lib/export";

describe("exam stages and countdown", () => {
  it("names how close an exam is", () => {
    expect(examStage(20, 20 * 1440)).toBe("later");
    expect(examStage(6, 6 * 1440)).toBe("week");
    expect(examStage(3, 3 * 1440)).toBe("soon");
    expect(examStage(1, 900)).toBe("tomorrow");
    expect(examStage(0, 90)).toBe("today");
    expect(examStage(0, 0)).toBe("now");
  });

  it("writes a friendly countdown", () => {
    expect(countdown(5, 5 * 1440)).toBe("in 5 days");
    expect(countdown(1, 1000)).toBe("tomorrow");
    expect(countdown(0, 135)).toBe("in 2 h 15 min");
    expect(countdown(0, 20)).toBe("in 20 min");
    expect(countdown(0, -5)).toBe("now");
  });
});

describe("Poli's suggestions", () => {
  const base = { course: "Mechanics", startTime: "09:00", room: "A101", building: "Mechanical Engineering" };

  it("always says where to go on the day", () => {
    expect(examHeadline({ ...base, daysLeft: 0, minutesUntil: 120 })).toContain("room A101 (Mechanical Engineering)");
    expect(examTips({ ...base, daysLeft: 0, minutesUntil: 120 })[0]).toBe("Be at room A101 (Mechanical Engineering) by 08:45, 15 minutes before it starts.");
    expect(examTips({ ...base, daysLeft: 0, minutesUntil: 120, travelMinutes: 20 })[0]).toContain("35 minutes before 09:00");
  });

  it("suggests sleep the day before and practice a few days ahead", () => {
    expect(examTips({ ...base, daysLeft: 1, minutesUntil: 1440 }).join(" ")).toMatch(/Sleep/);
    expect(examTips({ ...base, daysLeft: 3, minutesUntil: 3 * 1440 }).join(" ")).toMatch(/past exam|mock test/);
  });

  it("copes with a missing room", () => {
    expect(whereTo(null, null)).toBe("the room on the exam list");
    expect(whereTo(null, "ASPC")).toBe("ASPC");
  });

  it("picks an everyday tip from the list", () => {
    expect(EVERYDAY_TIPS).toContain(everydayTip("2026-11-21"));
  });
});

describe("exam alarms in the .ics export", () => {
  it("adds a reminder a day and two hours before", () => {
    const ics = toICS([{ uid: "exam-1", title: "Exam: Mechanics · A101", description: "", location: "A101", date: "2027-01-20", startMin: 540, endMin: 720, alarms: [1440, 120] }]);
    expect(ics).toContain("BEGIN:VALARM");
    expect(ics).toContain("TRIGGER:-PT1440M");
    expect(ics).toContain("TRIGGER:-PT120M");
    expect(ics.indexOf("END:VALARM")).toBeLessThan(ics.indexOf("END:VEVENT"));
  });

  it("adds no alarm to ordinary events", () => {
    const ics = toICS([{ uid: "p-1", title: "Gym", description: "", location: "", date: "2027-01-20", startMin: 1080, endMin: 1140 }]);
    expect(ics).not.toContain("VALARM");
  });
});

describe("Romanian counts on the landing page", () => {

  it("says 1 oră, 19 ore, 20 de ore, 2.374 de ore, 101 ore", () => {
    expect(roCount(1, "oră", "ore")).toBe("1 oră");
    expect(roCount(19, "oră", "ore")).toBe("19 ore");
    expect(roCount(20, "oră", "ore")).toBe("20 de ore");
    expect(roCount(2374, "oră", "ore")).toBe("2.374 de ore");
    expect(roCount(101, "examen", "examene")).toBe("101 examene");
    expect(roCount(100, "examen", "examene")).toBe("100 de examene");
  });
});
