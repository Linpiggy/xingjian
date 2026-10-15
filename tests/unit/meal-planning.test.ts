import { describe, expect, it } from "vitest";
import {
  scheduleMealDay,
  type DayActivity,
  type MealDayInput,
  type VenueRules,
} from "@/domain/meal-planning";
import { mealDayInputSchema, minuteWindowSchema } from "@/lib/meal-contracts";
import { places, route } from "../fixtures/draft";

function rules(): VenueRules {
  return {
    date: "2026-10-17",
    openingWindows: [{ startMinute: 480, endMinute: 1320 }],
    lastEntryMinute: 1200,
    reservation: { state: "not_required", entryWindow: null },
    source: { kind: "user", recordedAt: "2026-10-14T01:00:00Z" },
  };
}
function activity(index: number, kind: DayActivity["kind"]): DayActivity {
  return {
    id: `activity:test-${index}`,
    kind,
    place: {
      ...structuredClone(places[index]),
      name:
        kind === "visit"
          ? places[index].name
          : `测试${kind === "lunch" ? "午餐" : "晚餐"}厅`,
    },
    stayMinutes: kind === "visit" ? 90 : 60,
    fixedStartMinute: null,
    window:
      kind === "visit"
        ? null
        : kind === "lunch"
          ? { startMinute: 690, endMinute: 840 }
          : { startMinute: 1050, endMinute: 1200 },
    rules: rules(),
    meal:
      kind === "visit"
        ? null
        : {
            perPersonFen: kind === "lunch" ? 110 : 220,
            dietaryCheck: "user_checked",
            source: { kind: "user", recordedAt: "2026-10-14T01:30:00Z" },
          },
  };
}
function base(): MealDayInput {
  const activities = [
    activity(0, "visit"),
    activity(1, "lunch"),
    activity(2, "visit"),
    activity(3, "dinner"),
  ];
  return {
    date: "2026-10-17",
    timeZone: "Asia/Shanghai",
    startMinute: 540,
    endMinute: 1260,
    bufferMinutes: 15,
    activities,
    legs: activities.slice(1).map((item, index) => ({
      fromActivityId: activities[index].id,
      toActivityId: item.id,
      route: structuredClone(route),
    })),
  };
}
const codes = (result: ReturnType<typeof scheduleMealDay>) =>
  result.issues.map((issue) => issue.code);

describe("formal lunch/dinner ordered planning foundation, not a connected UI", () => {
  it("waits for both explicit meal windows, preserves order and stops, and remains unverified", () => {
    const input = mealDayInputSchema.parse(base());
    const before = structuredClone(input);
    const result = scheduleMealDay(input);
    expect(result.items.map((item) => item.startMinute)).toEqual([540, 690, 785, 1050]);
    expect(result.items.map((item) => item.endMinute)).toEqual([630, 750, 875, 1110]);
    expect(result.items.map((item) => item.activity.id)).toEqual(
      input.activities.map((item) => item.id),
    );
    expect(result.status).toBe("unverified");
    expect(result.issues).toEqual([]);
    expect(input).toEqual(before);
    result.items[1].activity.place.name = "mutated result";
    result.legs[0].route!.source.queriedAt = "changed";
    expect(input).toEqual(before);
  });
  it("keeps unknown price and diet distinct from zero or a safety promise", () => {
    const input = base();
    input.activities[1].meal = {
      perPersonFen: null,
      dietaryCheck: "unknown",
      source: { kind: "user", recordedAt: "2026-10-14T01:30:00Z" },
    };
    const result = scheduleMealDay(input);
    expect(codes(result)).toEqual(
      expect.arrayContaining(["meal_price_unknown", "dietary_unknown"]),
    );
    expect(result.items[1].activity.meal?.perPersonFen).toBeNull();
    expect(result.status).toBe("unverified");
    input.activities[1].meal!.perPersonFen = 0;
    expect(codes(scheduleMealDay(input))).not.toContain("meal_price_unknown");
    expect(scheduleMealDay(input).notices.join(" ")).toContain("过敏安全");
    expect(scheduleMealDay(input).notices.join(" ")).toContain("明确零元也不代表免费");
  });
  it("reports an explicit user dietary conflict without deleting the meal or restriction", () => {
    const input = base();
    input.activities[1].meal!.dietaryCheck = "user_conflict";
    const result = scheduleMealDay(input);
    expect(result.status).toBe("infeasible");
    expect(codes(result)).toContain("dietary_conflict");
    expect(result.items).toHaveLength(4);
    expect(result.items[1].activity.meal?.dietaryCheck).toBe("user_conflict");
  });
  it("does not invent missing formal meals or remove duplicate meal roles", () => {
    const input = base();
    input.activities[3].kind = "lunch";
    const result = scheduleMealDay(input);
    expect(codes(result).filter((code) => code === "meal_count")).toHaveLength(2);
    expect(result.status).toBe("infeasible");
    expect(result.items).toHaveLength(4);
    input.activities = input.activities.filter((item) => item.kind === "visit");
    expect(
      codes(scheduleMealDay(input)).filter((code) => code === "meal_count"),
    ).toHaveLength(2);
  });
  it("distinguishes a closed venue from unknown or wrong-date opening rules", () => {
    const input = base();
    input.activities[1].rules!.openingWindows = [];
    expect(scheduleMealDay(input).status).toBe("infeasible");
    input.activities[1].rules!.openingWindows = null;
    expect(scheduleMealDay(input).status).toBe("unverified");
    expect(codes(scheduleMealDay(input))).toContain("opening_unknown");
    input.activities[1].rules!.openingWindows = [];
    input.activities[1].rules!.date = "2026-10-18";
    expect(scheduleMealDay(input).status).toBe("unverified");
    expect(codes(scheduleMealDay(input))).toContain("rules_date_mismatch");
    input.activities[1].rules = null;
    expect(codes(scheduleMealDay(input))).toContain("rules_unknown");
  });
  it("uses the next whole opening interval instead of eating through a closure", () => {
    const input = base();
    input.activities[1].window = { startMinute: 690, endMinute: 900 };
    input.activities[1].rules!.openingWindows = [
      { startMinute: 780, endMinute: 900 },
      { startMinute: 660, endMinute: 720 },
    ];
    const original = structuredClone(input.activities[1].rules!.openingWindows);
    const result = scheduleMealDay(input);
    expect(result.items[1].startMinute).toBe(780);
    expect(result.items[1].endMinute).toBe(840);
    expect(result.status).toBe("unverified");
    expect(input.activities[1].rules!.openingWindows).toEqual(original);
  });
  it("merges overlapping or adjacent opening coverage for calculation without editing the input facts", () => {
    const input = base();
    input.activities[1].rules!.openingWindows = [
      { startMinute: 720, endMinute: 810 },
      { startMinute: 660, endMinute: 720 },
    ];
    const result = scheduleMealDay(input);
    expect(result.items[1].startMinute).toBe(690);
    expect(result.items[1].endMinute).toBe(750);
    expect(result.status).toBe("unverified");
    expect(result.items[1].activity.rules!.openingWindows).toHaveLength(2);
    input.activities[1].rules!.openingWindows![0].startMinute = 700;
    expect(scheduleMealDay(input).status).toBe("unverified");
  });
  it("allows finishing exactly at closing, but not after closing or after last entry", () => {
    const input = base();
    input.activities[1].rules!.openingWindows = [{ startMinute: 690, endMinute: 750 }];
    input.activities[1].rules!.lastEntryMinute = 690;
    expect(scheduleMealDay(input).status).toBe("unverified");
    input.activities[1].rules!.lastEntryMinute = 689;
    expect(codes(scheduleMealDay(input))).toContain("window_unreachable");
    input.activities[1].rules!.lastEntryMinute = 690;
    input.activities[1].rules!.openingWindows![0].endMinute = 749;
    expect(codes(scheduleMealDay(input))).toContain("window_unreachable");
  });
  it("treats confirmed reservation windows as half-open ENTRY windows, not stay end times", () => {
    const input = base();
    input.activities[1].rules!.reservation = {
      state: "confirmed",
      entryWindow: { startMinute: 700, endMinute: 710 },
    };
    const result = scheduleMealDay(input);
    expect(result.items[1].startMinute).toBe(700);
    expect(result.items[1].endMinute).toBe(760);
    expect(result.status).toBe("unverified");
    input.activities[1].fixedStartMinute = 710;
    expect(codes(scheduleMealDay(input))).toContain("locked_window_conflict");
  });
  it("does not turn unknown or required-but-unconfirmed reservations into confirmed bookings", () => {
    const input = base();
    for (const state of ["unknown", "required_unconfirmed"] as const) {
      input.activities[1].rules!.reservation.state = state;
      const result = scheduleMealDay(input);
      expect(codes(result)).toContain("reservation_unverified");
      expect(result.items[1].activity.rules!.reservation.state).toBe(state);
      expect(result.status).toBe("unverified");
    }
    input.activities[1].rules!.reservation.state = "confirmed";
    expect(codes(scheduleMealDay(input))).toContain("reservation_window_unknown");
  });
  it("waits for a reachable lock but never shifts a conflicting lock or removes it", () => {
    const input = base();
    input.activities[2].fixedStartMinute = 1000;
    expect(scheduleMealDay(input).items[2].startMinute).toBe(1000);
    input.activities[2].fixedStartMinute = 780;
    const result = scheduleMealDay(input);
    expect(codes(result)).toContain("locked_start_missed");
    expect(result.items[2].activity.fixedStartMinute).toBe(780);
    expect(result.status).toBe("infeasible");
    input.activities[1].fixedStartMinute = 600;
    expect(codes(scheduleMealDay(input))).toContain("locked_window_conflict");
  });
  it("never recovers exact times through a lock after an unknown directed route", () => {
    const input = base();
    input.legs[0].route = null;
    input.activities[2].fixedStartMinute = 900;
    const result = scheduleMealDay(input);
    expect(
      result.items
        .slice(1)
        .every(
          (item) =>
            item.startMinute === null && item.endMinute === null && item.startAt === null,
        ),
    ).toBe(true);
    expect(codes(result)).toContain("locked_start_unverified");
    expect(codes(result)).toContain("window_unverified");
    expect(result.status).toBe("unverified");
  });
  it("unknown route time does not conceal provable lock, opening or day-end conflicts", () => {
    const input = base();
    input.legs[0].route = null;
    input.activities[2].fixedStartMinute = 780;
    let result = scheduleMealDay(input);
    expect(result.items[2].startMinute).toBeNull();
    expect(codes(result)).toContain("locked_start_missed");
    expect(result.status).toBe("infeasible");
    input.activities[2].fixedStartMinute = null;
    input.activities[1].rules!.openingWindows = [];
    expect(codes(scheduleMealDay(input))).toContain("window_unreachable");
    input.activities[1].rules = rules();
    input.endMinute = 1100;
    result = scheduleMealDay(input);
    expect(codes(result)).toContain("day_end_exceeded");
    expect(result.items[3].startMinute).toBeNull();
  });
  it("old endpoints and reverse routes are not reused, even as lower bounds", () => {
    const input = base();
    [input.legs[0].fromActivityId, input.legs[0].toActivityId] = [
      input.legs[0].toActivityId,
      input.legs[0].fromActivityId,
    ];
    input.legs[0].route!.seconds = 86_400;
    const result = scheduleMealDay(input);
    expect(result.legs[0].route).toBeNull();
    expect(result.items[1].startMinute).toBeNull();
    expect(codes(result)).not.toContain("day_end_exceeded");
    expect(result.status).toBe("unverified");
  });
  it("rounds total route seconds upward once and adds only one explicit buffer", () => {
    const input = base();
    input.activities[1].window = { startMinute: 600, endMinute: 1000 };
    input.legs[0].route!.seconds = 1201;
    expect(scheduleMealDay(input).items[1].startMinute).toBe(666);
    input.legs[0].route!.seconds = 0;
    input.bufferMinutes = 0;
    expect(scheduleMealDay(input).items[1].startMinute).toBe(630);
    input.legs[0].route!.seconds = null;
    expect(scheduleMealDay(input).items[1].startMinute).toBeNull();
  });
  it("uses distinct activity IDs for repeated venue visits and does not infer zero travel from equal POIs", () => {
    const input = base();
    input.activities[3].place = structuredClone(input.activities[1].place);
    expect(mealDayInputSchema.safeParse(input).success).toBe(true);
    expect(scheduleMealDay(input).items.map((item) => item.activity.id)).toHaveLength(4);
    input.legs[2].route = null;
    expect(scheduleMealDay(input).items[3].startMinute).toBeNull();
  });
  it("keeps complete Shanghai dates across midnight and year boundaries", () => {
    const input = base();
    input.date = "2026-12-31";
    input.startMinute = 1380;
    input.endMinute = 1560;
    input.bufferMinutes = 0;
    input.activities = [input.activities[1], input.activities[3]];
    input.activities.forEach((item, index) => {
      item.stayMinutes = 30;
      item.window = { startMinute: index ? 1455 : 1380, endMinute: index ? 1560 : 1440 };
      item.rules!.date = input.date;
      item.rules!.openingWindows = [{ startMinute: 1380, endMinute: 1560 }];
      item.rules!.lastEntryMinute = 1559;
    });
    input.legs = [
      {
        fromActivityId: input.activities[0].id,
        toActivityId: input.activities[1].id,
        route: structuredClone(route),
      },
    ];
    const result = scheduleMealDay(mealDayInputSchema.parse(input));
    expect(result.items[1].startMinute).toBe(1455);
    expect(result.items[1].startAt).toBe("2026-12-31T16:15:00.000Z");
    expect(result.items[1].endAt).toBe("2026-12-31T16:45:00.000Z");
    expect(result.status).toBe("unverified");
  });
  it("strictly rejects invalid dates, windows, negative/fractional money and undeclared facts", () => {
    expect(
      minuteWindowSchema.safeParse({ startMinute: 690, endMinute: 690 }).success,
    ).toBe(false);
    expect(
      minuteWindowSchema.safeParse({ startMinute: 0, endMinute: 2881 }).success,
    ).toBe(false);
    for (const amount of [-1, 1.1, 10_000_001, Infinity]) {
      const input = base();
      input.activities[1].meal!.perPersonFen = amount;
      expect(mealDayInputSchema.safeParse(input).success).toBe(false);
    }
    for (const invalid of [
      { ...base(), date: "2026-02-30" },
      { ...base(), timeZone: "UTC" },
      { ...base(), endMinute: 540 },
      { ...base(), ownerId: "cannot-authorize" },
    ]) {
      expect(mealDayInputSchema.safeParse(invalid).success).toBe(false);
    }
    const input = base();
    const badFacts = { ...input.activities[1].rules, allergySafe: true };
    expect(
      mealDayInputSchema.safeParse({
        ...input,
        activities: [{ ...input.activities[1], rules: badFacts }],
      }).success,
    ).toBe(false);
    expect(
      mealDayInputSchema.safeParse({
        ...input,
        activities: [
          {
            ...input.activities[1],
            place: {
              ...input.activities[1].place,
              source: {
                ...input.activities[1].place.source,
                toolUrl: "https://invalid.example/",
              },
            },
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("requires an independent recorded user source for meal price/diet even when venue rules are unknown", () => {
    const input = base();
    input.activities[1].rules = null;
    const withMeal = (meal: unknown) => ({
      ...input,
      activities: input.activities.map((item, index) =>
        index === 1 ? { ...item, meal } : item,
      ),
    });
    expect(
      mealDayInputSchema.safeParse(
        withMeal({ perPersonFen: 110, dietaryCheck: "unknown" }),
      ).success,
    ).toBe(false);
    const recorded = {
      ...input.activities[1].meal,
      source: { kind: "user", recordedAt: "2026-10-14T02:00:00Z" },
    };
    const parsed = mealDayInputSchema.parse(withMeal(recorded));
    expect(scheduleMealDay(parsed).items[1].activity.meal).toEqual(recorded);
    for (const source of [
      null,
      { kind: "provider", recordedAt: "2026-10-14T02:00:00Z" },
      { kind: "user", recordedAt: "invalid" },
      {
        kind: "user",
        recordedAt: "2026-10-14T02:00:00Z",
        receiptNumber: "not-collected",
      },
    ]) {
      expect(
        mealDayInputSchema.safeParse(withMeal({ ...recorded, source })).success,
      ).toBe(false);
    }
  });
  it("rejects ambiguous activity or route IDs, invalid meal fields and route durations", () => {
    const input = base();
    expect(
      mealDayInputSchema.safeParse({
        ...input,
        activities: [input.activities[0], input.activities[0]],
      }).success,
    ).toBe(false);
    expect(
      mealDayInputSchema.safeParse({ ...input, legs: [input.legs[0], input.legs[0]] })
        .success,
    ).toBe(false);
    expect(
      mealDayInputSchema.safeParse({
        ...input,
        activities: [{ ...input.activities[1], window: null }],
      }).success,
    ).toBe(false);
    expect(
      mealDayInputSchema.safeParse({
        ...input,
        activities: [{ ...input.activities[0], meal: input.activities[1].meal }],
      }).success,
    ).toBe(false);
    for (const seconds of [-1, 86_401, Infinity]) {
      input.legs[0].route!.seconds = seconds;
      expect(mealDayInputSchema.safeParse(input).success).toBe(false);
    }
  });
});
