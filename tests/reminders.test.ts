import { describe, expect, it } from "vitest";
import { exams } from "@/i18n/messages/exams";
import { planTrip } from "@/lib/directions";
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

describe("Poli's suggestions in Romanian", () => {
  const base = { course: "Mecanică", startTime: "09:00", room: "A101", building: "Corp Mecanică" };

  it("writes the countdown with Romanian plurals", () => {
    expect(countdown(5, 5 * 1440, "ro")).toBe("în 5 zile");
    expect(countdown(21, 21 * 1440, "ro")).toBe("în 21 de zile");
    expect(countdown(1, 1000, "ro")).toBe("mâine");
    expect(countdown(0, 135, "ro")).toBe("în 2 h 15 min");
    expect(countdown(0, -5, "ro")).toBe("acum");
  });

  it("says where to go and when to leave", () => {
    expect(whereTo("A101", "Corp Mecanică", "ro")).toBe("sala A101 (Corp Mecanică)");
    expect(whereTo(null, null, "ro")).toBe("sala din lista de examene");
    expect(examHeadline({ ...base, daysLeft: 0, minutesUntil: 120 }, "ro")).toBe("Examen la Mecanică azi la 09:00, sala A101 (Corp Mecanică). Te descurci! 💪");
    expect(examTips({ ...base, daysLeft: 0, minutesUntil: 120 }, "ro")[0]).toBe("Fii la sala A101 (Corp Mecanică) până la 08:45, cu 15 minute înainte de început.");
    expect(examTips({ ...base, daysLeft: 0, minutesUntil: 120, travelMinutes: 20 }, "ro")[0]).toContain("cu vreo 35 de minute înainte de 09:00");
    expect(examHeadline({ ...base, daysLeft: 20, minutesUntil: 20 * 1440 }, "ro")).toContain("în 20 de zile");
  });

  it("gives as many tips in both languages and picks the everyday tip from the Romanian list", () => {
    for (const daysLeft of [0, 1, 3, 6, 20]) {
      const input = { ...base, daysLeft, minutesUntil: daysLeft * 1440 + 60 };
      expect(examTips(input, "ro")).toHaveLength(examTips(input).length);
    }
    expect(exams.ro.everyday).toHaveLength(EVERYDAY_TIPS.length);
    expect(exams.ro.everyday).toContain(everydayTip("2026-11-21", "ro"));
    expect(EVERYDAY_TIPS.indexOf(everydayTip("2026-11-21"))).toBe(exams.ro.everyday.indexOf(everydayTip("2026-11-21", "ro")));
  });
});

describe("travel suggestions in Romanian", () => {
  const electro = { name: "Corp Electro", address: null, lat: 45.7475, lng: 21.2262, approximate: false };

  it("gives the campus mode switch its own estimate for every mode", () => {
    const nearby = { lat: 45.751, lng: 21.2262 };
    const usual = planTrip(nearby, electro);
    expect(usual.options.map((o) => o.mode)).toEqual(["walk"]);
    const campus = planTrip(nearby, electro, "en", true);
    expect(campus.options.map(({ mode, minutes }) => [mode, minutes])).toEqual([
      ["walk", 6], ["bike", 4], ["transit", 10], ["drive", 6],
    ]);
    expect(campus.summary).toBe(usual.summary);
    expect(campus.leaveMinutesBefore).toBe(11);
  });

  it("labels the options and uses a decimal comma", () => {
    const far = planTrip({ lat: 45.79, lng: 21.3 }, electro, "ro");
    expect(far.options.map((o) => o.label)).toContain("Transport în comun");
    expect(far.summary).toMatch(/^Corp Electro e la aproximativ \d+,\d km\. /);
    expect(planTrip({ lat: 45.7475, lng: 21.2262 }, electro, "ro").summary).toBe("Ești deja la Corp Electro.");
    // English stays the default, for the assistant model.
    expect(planTrip({ lat: 45.79, lng: 21.3 }, electro).summary).toMatch(/is about \d+\.\d km away/);
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
