import { describe, expect, it } from "vitest";
import { haversineMeters, planTrip } from "@/lib/directions";
import { toICS, type ExportItem } from "@/lib/export";
import { holidaysBetween, orthodoxEaster } from "@/lib/holidays";
import { freeSlots } from "@/lib/schedule";
import { addDays, daysBetween, mondayOf, nowLocal, weekMatches, weekday } from "@/lib/time";

describe("time helpers", () => {
  it("computes Romania’s fixed and Orthodox holidays for the requested year", () => {
    expect(orthodoxEaster(2027)).toBe("2027-05-02");
    const dates = holidaysBetween("2027-01-01", "2027-12-31");
    expect(dates.map((h) => h.date.slice(5))).toEqual([
      "01-01", "01-02", "01-06", "01-07", "01-24", "04-30", "05-01", "05-02", "05-03",
      "06-01", "06-20", "06-21", "08-15", "11-30", "12-01", "12-25", "12-26",
    ]);
    expect(dates.find((h) => h.date === "2027-06-20")?.name).toBe("Orthodox Pentecost Sunday");
    expect(holidaysBetween("2026-06-01", "2026-06-01", "ro")).toEqual([{ date: "2026-06-01", name: "Ziua Copilului / A doua zi de Rusalii" }]);
    expect(holidaysBetween("2026-12-26", "2027-01-02").map((h) => h.date)).toEqual(["2026-12-26", "2027-01-01", "2027-01-02"]);
  });

  it("does calendar arithmetic on ISO dates", () => {
    expect(weekday("2026-11-20")).toBe(5); // a Friday
    expect(mondayOf("2026-11-20")).toBe("2026-11-16");
    expect(mondayOf("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the same week
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-09-28", "2026-10-05")).toBe(7);
  });

  it("reports wall-clock time in Timișoara regardless of the server's zone", () => {
    // 22:30 UTC on 20 Nov is already 00:30 on 21 Nov in Romania (UTC+2 in winter).
    expect(nowLocal(new Date("2026-11-20T22:30:00Z"))).toEqual({ date: "2026-11-21", minutes: 30 });
    // In summer the offset is +3.
    expect(nowLocal(new Date("2026-06-15T09:00:00Z"))).toEqual({ date: "2026-06-15", minutes: 12 * 60 });
  });

  it("applies week rules", () => {
    expect(weekMatches("all", 5)).toBe(true);
    expect(weekMatches("odd", 5)).toBe(true);
    expect(weekMatches("even", 5)).toBe(false);
    expect(weekMatches("1-7", 7)).toBe(true);
    expect(weekMatches("1-7", 8)).toBe(false);
    expect([6, 7, 8, 9].filter((week) => weekMatches("odd&1-7", week))).toEqual([7]);
    const weeks = Array.from({ length: 14 }, (_, i) => i + 1);
    expect(weeks.filter((week) => weekMatches("4,8,12,14", week))).toEqual([4, 8, 12, 14]);
    expect(weeks.filter((week) => weekMatches("1-7&even", week))).toEqual([2, 4, 6]);
    expect(weeks.filter((week) => !weekMatches("!1", week))).toEqual([1]);
  });
});

describe("freeSlots", () => {
  const busy = [
    { date: "2026-11-23", startMin: 8 * 60, endMin: 10 * 60 },
    { date: "2026-11-23", startMin: 10 * 60, endMin: 12 * 60 },
    { date: "2026-11-23", startMin: 16 * 60, endMin: 18 * 60 },
  ];

  it("finds gaps between classes inside the working day", () => {
    expect(freeSlots(busy, "2026-11-23", "2026-11-23")).toEqual([
      { date: "2026-11-23", startMin: 12 * 60, endMin: 16 * 60 },
      { date: "2026-11-23", startMin: 18 * 60, endMin: 20 * 60 },
    ]);
  });

  it("honours the minimum length and skips weekends", () => {
    expect(freeSlots(busy, "2026-11-23", "2026-11-23", { minMinutes: 180 })).toEqual([{ date: "2026-11-23", startMin: 12 * 60, endMin: 16 * 60 }]);
    // 21–22 Nov 2026 is a weekend.
    expect(freeSlots([], "2026-11-21", "2026-11-22")).toEqual([]);
    expect(freeSlots([], "2026-11-21", "2026-11-22", { weekdaysOnly: false })).toHaveLength(2);
  });

  it("measures the minimum gap inside the selected day bounds", () => {
    const busy = [{ date: "2026-11-23", startMin: 480, endMin: 1190 }, { date: "2026-11-23", startMin: 1300, endMin: 1400 }];
    expect(freeSlots(busy, "2026-11-23", "2026-11-23")).toEqual([]);
  });

  it("merges overlapping classes instead of reporting negative gaps", () => {
    const overlapping = [
      { date: "2026-11-24", startMin: 8 * 60, endMin: 12 * 60 },
      { date: "2026-11-24", startMin: 9 * 60, endMin: 10 * 60 },
    ];
    expect(freeSlots(overlapping, "2026-11-24", "2026-11-24")).toEqual([{ date: "2026-11-24", startMin: 12 * 60, endMin: 20 * 60 }]);
  });
});

describe("directions", () => {
  const electro = { name: "Clădirea Electro", address: "Bd. Vasile Pârvan 2", lat: 45.747476, lng: 21.226228, approximate: false };

  it("measures distance between campus buildings", () => {
    const chimie = { lat: 45.747792, lng: 21.233185 };
    const d = haversineMeters(electro, chimie);
    expect(d).toBeGreaterThan(450);
    expect(d).toBeLessThan(650);
  });

  it("recommends walking on campus and adds margin to leave on time", () => {
    const trip = planTrip({ lat: 45.7457, lng: 21.2228 }, electro); // from MPT
    expect(trip.options[0].mode).toBe("walk");
    expect(trip.options[0].minutes).toBeGreaterThan(2);
    expect(trip.options[0].minutes).toBeLessThan(12);
    expect(trip.leaveMinutesBefore).toBe(trip.options[0].minutes + 5);
    expect(trip.options[0].mapsUrl).toContain("travelmode=walking");
  });

  it("offers transit and car from across town, and nothing to do when already there", () => {
    const far = planTrip({ lat: 45.79, lng: 21.3 }, electro);
    expect(far.options.map((o) => o.mode)).toEqual(expect.arrayContaining(["transit", "drive"]));
    expect(far.options.some((o) => o.mode === "walk")).toBe(false);
    const here = planTrip({ lat: 45.7475, lng: 21.2262 }, electro);
    expect(here.leaveMinutesBefore).toBe(0);
    expect(here.summary).toMatch(/already at/);
  });
});

describe("toICS", () => {
  const items: ExportItem[] = [
    {
      uid: "entry-1",
      title: "Sisteme de operare 2 (Lecture)",
      description: "V. Stangaciu",
      location: "ASPC, Str. Ioan Curea 1; Timișoara",
      date: "2026-10-02",
      startMin: 14 * 60,
      endMin: 16 * 60,
      until: "2027-01-22",
      exdates: ["2026-12-25", "2027-01-01", "2027-01-08"],
    },
    { uid: "exam-7", title: "Exam: Electronică digitala", description: "", location: "D1", date: "2027-02-02", startMin: 8 * 60, endMin: 10 * 60 },
  ];
  const folded = toICS(items);
  const lines = folded.split("\r\n");
  // Content checks run on the unfolded text, as a calendar client would read it.
  const ics = folded.replace(/\r\n /g, "");

  it("produces a well-formed calendar with local times in Europe/Bucharest", () => {
    expect(lines[0]).toBe("BEGIN:VCALENDAR");
    expect(lines.at(-2)).toBe("END:VCALENDAR");
    expect(ics).toContain("BEGIN:VTIMEZONE");
    expect(ics).toContain("DTSTART;TZID=Europe/Bucharest:20261002T140000");
    expect(ics).toContain("DTEND;TZID=Europe/Bucharest:20261002T160000");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(2);
  });

  it("recurs weekly and skips the winter holiday", () => {
    expect(ics).toContain("RRULE:FREQ=WEEKLY;UNTIL=20270122T235959Z");
    expect(ics).toContain("EXDATE;TZID=Europe/Bucharest:20261225T140000,20270101T140000,20270108T140000");
    // One-off events carry no recurrence.
    const exam = ics.slice(ics.indexOf("UID:exam-7"));
    expect(exam.slice(0, exam.indexOf("END:VEVENT"))).not.toContain("RRULE");
  });

  it("escapes text and folds long lines", () => {
    expect(ics).toContain("LOCATION:ASPC\\, Str. Ioan Curea 1\\; Timișoara");
    expect(lines.every((l) => Buffer.byteLength(l, "utf8") <= 75)).toBe(true);
  });
});
