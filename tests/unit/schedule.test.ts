import { describe, expect, it } from "vitest";
import {
  ARRIVAL_SETTLE_MIN,
  requiredMeals,
  scheduleDay,
  TRANSFER_BUFFER_MIN,
  UNKNOWN_LEG_MIN,
} from "@/lib/schedule";
import { addDays, parseOpenWindow, toClock, toMinutes } from "@/lib/time";

const sight = (name: string, durationMin: number, openTime: string | null = null) => ({
  kind: "sight" as const,
  mealType: null,
  place: { name, openTime },
  durationMin,
});
const meal = (name: string, mealType: "lunch" | "dinner", durationMin = 60) => ({
  kind: "meal" as const,
  mealType,
  place: { name, openTime: null },
  durationMin,
});

describe("time helpers", () => {
  it("converts clock values", () => {
    expect(toMinutes("09:30")).toBe(570);
    expect(toClock(570)).toBe("09:30");
    expect(toMinutes("25:00")).toBeNull();
  });

  it("parses opening windows including overnight", () => {
    expect(parseOpenWindow("周一至周日 07:30-18:00")).toEqual({ open: 450, close: 1080 });
    expect(parseOpenWindow("18:00-次日02:00")).toEqual({ open: 1080, close: 1560 });
    expect(parseOpenWindow("全天开放")).toBeNull();
  });

  it("adds days across month and year boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-02-28", 1)).toBe("2026-03-01");
  });
});

describe("scheduleDay", () => {
  it("chains stops with real travel time plus a transfer buffer", () => {
    const { slots } = scheduleDay(
      "balanced",
      [sight("A", 60), sight("B", 30)],
      [{ minutes: 20 }],
    );
    expect(slots[0]).toMatchObject({ start: "09:00", end: "10:00" });
    expect(slots[1].start).toBe(toClock(600 + 20 + TRANSFER_BUFFER_MIN));
  });

  it("waits for the lunch window instead of eating too early", () => {
    const { slots } = scheduleDay(
      "balanced",
      [sight("A", 60), meal("L", "lunch")],
      [{ minutes: 10 }],
    );
    expect(slots[1].start).toBe("11:30");
    expect(slots[1].warnings.join()).toContain("空闲");
  });

  it("warns when arriving after closing time and never drops the stop", () => {
    const { slots } = scheduleDay(
      "balanced",
      [sight("A", 600), sight("Museum", 90, "09:00-17:00")],
      [{ minutes: 15 }],
    );
    expect(slots).toHaveLength(2);
    expect(slots[1].warnings.join()).toContain("结束营业");
  });

  it("delays to opening time", () => {
    const { slots } = scheduleDay("packed", [sight("Temple", 60, "09:30-17:00")], []);
    expect(slots[0].start).toBe("09:30");
  });

  it("uses a labelled estimate for unknown legs", () => {
    const { slots, warnings } = scheduleDay(
      "balanced",
      [sight("A", 60), sight("B", 60)],
      [{ minutes: null }],
    );
    expect(slots[1].start).toBe(toClock(600 + UNKNOWN_LEG_MIN + TRANSFER_BUFFER_MIN));
    expect(warnings.join()).toContain("未取得路线数据");
  });

  it("starts day one after arrival plus settling time and the hotel leg", () => {
    const { slots } = scheduleDay("balanced", [sight("A", 60)], [], {
      arrival: "13:00",
      startLeg: { minutes: 20 },
    });
    expect(slots[0].start).toBe(
      toClock(13 * 60 + ARRIVAL_SETTLE_MIN + 20 + TRANSFER_BUFFER_MIN),
    );
  });

  it("warns when the last day ends too close to departure", () => {
    const { warnings } = scheduleDay("balanced", [sight("A", 360)], [], {
      departure: "15:00",
    });
    expect(warnings.join()).toContain("返程");
  });

  it("relaxes required meals around arrival and departure", () => {
    expect(requiredMeals(1, 2, "10:30", "17:00")).toEqual(["lunch", "dinner"]);
    expect(requiredMeals(2, 2, "10:30", "17:00")).toEqual(["lunch"]);
    expect(requiredMeals(1, 2, "15:00", null)).toEqual(["dinner"]);
    expect(requiredMeals(1, 1, null, null)).toEqual(["lunch", "dinner"]);
  });
});
