import { describe, expect, it } from "vitest";
import { availabilityDays, hourViews } from "@/components/AvailabilityCharts";
import { planningRange } from "@/lib/planning-range";
import { addDays } from "@/lib/time";

const today = "2026-11-21";

describe("group planning dates", () => {
  it("uses seven calendar dates across weeks, months and years", () => {
    expect(planningRange(today, {}).range).toEqual({ from: today, to: "2026-11-27" });
    expect(planningRange("2026-12-31", {}).range).toEqual({ from: "2026-12-31", to: "2027-01-06" });
  });

  it("allows a single day, trims elapsed dates in saved links and reports invalid ranges", () => {
    expect(planningRange(today, { from: "2026-11-18", to: today })).toMatchObject({
      visible: { from: today, to: today }, totalDays: 1, error: undefined,
    });
    for (const params of [{ from: today }, { from: today, to: "2027-02-29" },
      { from: [today], to: today }, { from: today, to: "2026-11-20" }, { from: "2026-11-18", to: "2026-11-20" }]) {
      expect(planningRange(today, params).error).toBeDefined();
    }
  });

  it("keeps long ranges contiguous through the last day, including at the supported date boundary", () => {
    const range = { from: today, to: "2027-02-01" };
    const first = planningRange(today, { ...range, page: "0" });
    const second = planningRange(today, { ...range, page: "2" });
    const last = planningRange(today, { ...range, page: "500" });
    expect(first).toMatchObject({ totalDays: 73, pageCount: 3, page: 1, visible: { from: today, to: "2026-12-21" } });
    expect(second.visible).toEqual({ from: addDays(first.visible.to, 1), to: "2027-01-21" });
    expect(last).toMatchObject({ page: 3, visible: { from: addDays(second.visible.to, 1), to: range.to } });
    expect(planningRange(today, { from: "9999-12-01", to: "9999-12-31" }).visible.to).toBe("9999-12-31");
  });

  it("shows busy days in the calendar and totals only the displayed free windows", () => {
    const first = { date: today, startMin: 900, endMin: 960 };
    const second = { date: today, startMin: 1020, endMin: 1080 };
    const full = { date: "2026-11-23", startMin: 0, endMin: 1440 };
    const days = availabilityDays({ from: today, to: full.date }, [first, second, full]);
    expect(days).toEqual([
      { date: today, slots: [first, second], freeMinutes: 120 },
      { date: "2026-11-22", slots: [], freeMinutes: 0 },
      { date: full.date, slots: [full], freeMinutes: 1440 },
    ]);
    const evenings = availabilityDays({ from: today, to: full.date }, [first, second, full], hourViews[2]);
    expect(evenings.map((day) => day.freeMinutes)).toEqual([0, 0, 360]);
    expect(evenings[2].slots).toEqual([{ date: full.date, startMin: 1080, endMin: 1440 }]);
  });
});
