import { describe, expect, it } from "vitest";
import {
  briefBudget,
  briefDays,
  dailyBudgetTargetFen,
  type TripBrief,
} from "@/domain/trip-brief";
import { tripBriefSchema } from "@/lib/trip-brief-contracts";

function brief(): TripBrief {
  return {
    destinationCity: "测试城市",
    originCity: null,
    startDate: "2026-12-31",
    dayCount: 1,
    travelers: 1,
    budget: {
      amountFen: 150000,
      basis: "per_person",
      includeIntercity: true,
      includeLodging: true,
    },
    availability: {
      firstDayStartMinute: 600,
      lastDayEndMinute: 1080,
      dailyStartMinute: 540,
      dailyEndMinute: 1260,
    },
    mainPurpose: "culture",
    secondaryPurposes: ["food", "photography"],
    pace: "balanced",
    mustVisit: [],
    mustEat: [],
    dietary: { avoid: [], allergies: [] },
  };
}
describe("full trip brief boundary, independent of the legacy six-place draft", () => {
  it("accepts a one-person one-day trip without requiring user-selected places or restaurants", () => {
    const input = brief();
    expect(tripBriefSchema.parse(input)).toEqual(input);
    expect(briefDays(input)).toEqual([
      { date: "2026-12-31", activityWindow: { startMinute: 600, endMinute: 1080 } },
    ]);
    expect(briefBudget(input)).toEqual({
      totalFen: 150000,
      perPersonFloorFen: 150000,
      remainderFen: 0,
    });
  });
  it("allocates daily reference targets in integer fen without inventing actual expenses", () => {
    const input = brief();
    input.dayCount = 3;
    input.budget.amountFen = 110;
    input.budget.basis = "total";
    expect([0, 1, 2].map((index) => dailyBudgetTargetFen(input, index))).toEqual([
      37, 37, 36,
    ]);
    input.dayCount = 14;
    input.travelers = 20;
    input.budget.basis = "per_person";
    expect(
      Array.from({ length: 14 }, (_, index) => dailyBudgetTargetFen(input, index)).reduce(
        (sum, value) => sum + value,
        0,
      ),
    ).toBe(2200);
    input.budget.amountFen = 0;
    expect(dailyBudgetTargetFen(input, 0)).toBe(0);
  });
  it("rejects dates outside the target budget rather than assigning a phantom day", () => {
    for (const index of [-1, 1, 0.5, NaN]) {
      expect(() => dailyBudgetTargetFen(brief(), index)).toThrow("超出");
    }
  });
  it("accepts fourteen days and twenty people, preserving all dates across a year", () => {
    const input = brief();
    input.dayCount = 14;
    input.travelers = 20;
    expect(tripBriefSchema.safeParse(input).success).toBe(true);
    expect(briefDays(input)).toHaveLength(14);
    expect(briefDays(input).at(-1)?.date).toBe("2027-01-13");
    expect(briefBudget(input).totalFen).toBe(3_000_000);
  });
  it.each([
    { dayCount: 0 },
    { dayCount: 15 },
    { dayCount: 1.5 },
    { travelers: 0 },
    { travelers: 21 },
    { travelers: 1.5 },
  ])("rejects unsupported scale %j", (change) => {
    expect(tripBriefSchema.safeParse({ ...brief(), ...change }).success).toBe(false);
  });
  it("keeps budget basis and scope explicit, splits integer fen without inflating the party budget", () => {
    const input = brief();
    input.travelers = 3;
    input.budget = {
      amountFen: 110,
      basis: "total",
      includeIntercity: false,
      includeLodging: false,
    };
    expect(tripBriefSchema.safeParse(input).success).toBe(true);
    expect(briefBudget(input)).toEqual({
      totalFen: 110,
      perPersonFloorFen: 36,
      remainderFen: 2,
    });
    expect(input.budget.includeIntercity).toBe(false);
    expect(input.budget.includeLodging).toBe(false);
    input.budget.amountFen = 0;
    expect(briefBudget(input).totalFen).toBe(0);
    expect(tripBriefSchema.safeParse(input).success).toBe(true);
    for (const amountFen of [-1, 1.1, NaN, Infinity, 200_000_001]) {
      input.budget.amountFen = amountFen;
      expect(tripBriefSchema.safeParse(input).success).toBe(false);
    }
  });
  it("applies the existing per-person target cap consistently to either budget basis", () => {
    const input = brief();
    input.budget.amountFen = 10_000_001;
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
    input.budget.basis = "total";
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
    input.travelers = 20;
    input.budget.amountFen = 200_000_000;
    expect(tripBriefSchema.safeParse(input).success).toBe(true);
    expect(briefBudget(input).perPersonFloorFen).toBe(10_000_000);
  });
  it("intersects first/last day boundaries with daily availability rather than allocating a full day to both", () => {
    const input = brief();
    input.dayCount = 3;
    input.availability.firstDayStartMinute = 900;
    input.availability.lastDayEndMinute = 720;
    const before = structuredClone(input);
    expect(briefDays(input).map((day) => day.activityWindow)).toEqual([
      { startMinute: 900, endMinute: 1260 },
      { startMinute: 540, endMinute: 1260 },
      { startMinute: 540, endMinute: 720 },
    ]);
    expect(input).toEqual(before);
  });
  it("retains a late-arrival date with no touring window; never deletes it or fabricates touring time", () => {
    const input = brief();
    input.dayCount = 2;
    input.availability.firstDayStartMinute = 1380;
    expect(tripBriefSchema.safeParse(input).success).toBe(true);
    expect(briefDays(input)[0]).toEqual({ date: "2026-12-31", activityWindow: null });
    expect(briefDays(input)[1].date).toBe("2027-01-01");
    input.dayCount = 1;
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
  });
  it("validates real dates and non-empty same-day minute windows, allowing a midnight endpoint", () => {
    expect(
      tripBriefSchema.safeParse({ ...brief(), startDate: "2026-02-30" }).success,
    ).toBe(false);
    const input = brief();
    input.availability.dailyEndMinute = 1440;
    expect(tripBriefSchema.safeParse(input).success).toBe(true);
    input.availability.dailyStartMinute = 1440;
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
    input.availability.dailyStartMinute = 1260;
    input.availability.dailyEndMinute = 1260;
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
  });
  it("distinguishes must-eat dishes from must-eat venues, retaining hard requests and dietary conflicts for the planner", () => {
    const input = brief();
    input.mustVisit = ["必去博物馆"];
    input.mustEat = [
      { kind: "dish", name: "测试菜品" },
      { kind: "restaurant", name: "测试餐厅" },
    ];
    input.dietary.allergies = ["测试菜品"];
    const parsed = tripBriefSchema.parse(input);
    expect(parsed.mustEat).toEqual(input.mustEat);
    expect(parsed.dietary.allergies).toEqual(["测试菜品"]);
    expect(parsed.mustVisit).toEqual(["必去博物馆"]);
  });
  it("rejects duplicate constraints and purposes without treating unknown raw names as verified POIs", () => {
    const input = brief();
    input.mustVisit = ["ＡＢＣ", "abc"];
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
    input.mustVisit = [];
    input.secondaryPurposes.push("culture");
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
    input.secondaryPurposes = ["food", "food"];
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
    input.secondaryPurposes = [];
    input.mustEat = [
      { kind: "dish", name: "测试菜品" },
      { kind: "dish", name: "测试菜品" },
    ];
    expect(tripBriefSchema.safeParse(input).success).toBe(false);
  });
  it("rejects blank cities, empty mandatory names, arbitrary model options and extra fields", () => {
    expect(tripBriefSchema.safeParse({ ...brief(), destinationCity: " " }).success).toBe(
      false,
    );
    expect(
      tripBriefSchema.safeParse({ ...brief(), mainPurpose: "model-invented-purpose" })
        .success,
    ).toBe(false);
    expect(tripBriefSchema.safeParse({ ...brief(), mustVisit: [""] }).success).toBe(
      false,
    );
    expect(
      tripBriefSchema.safeParse({ ...brief(), modelUrl: "https://untrusted.invalid" })
        .success,
    ).toBe(false);
    expect(
      tripBriefSchema.safeParse({
        ...brief(),
        budget: { ...brief().budget, status: "within_budget" },
      }).success,
    ).toBe(false);
  });
});
