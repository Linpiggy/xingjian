import { describe, expect, it } from "vitest";
import { createEditState } from "@/domain/editing";
import { stopIdentity } from "@/domain/meals";
import {
  buildMealForm,
  initialMealForm,
  mealCostText,
  withoutMealDay,
} from "@/features/planner/meal-form";
import {
  buildIntercityForm,
  initialIntercityForm,
} from "@/features/planner/intercity-form";
import { fixtureDraft, places } from "../fixtures/draft";
const recordedAt = "2026-10-14T01:00:00Z";
function input() {
  const state = createEditState(structuredClone(fixtureDraft()), "form");
  const form = initialMealForm(state, 0);
  form.slots.lunch.place = structuredClone(places[0]);
  form.slots.dinner.place = structuredClone(places[1]);
  return { state, form };
}
describe("manual meal form boundary and provenance", () => {
  it("requires explicit candidates, uses unique stable instance IDs and keeps facts unknown", () => {
    const { state, form } = input();
    expect(form.slots.lunch.id).not.toBe(form.slots.dinner.id);
    const setup = buildMealForm(state, 0, form, recordedAt);
    expect(setup.days[0].entries.map((entry) => entry.rules)).toEqual([null, null]);
    expect(setup.days[0].entries[0].meal).toEqual({
      perPersonFen: null,
      dietaryCheck: "unknown",
      source: { kind: "user", recordedAt },
    });
    expect(setup.days[0].entries[0].window).toEqual({ startMinute: 690, endMinute: 840 });
    form.slots.dinner.place = null;
    expect(() => buildMealForm(state, 0, form, recordedAt)).toThrow("明确选择晚餐");
    expect(state.meals.days).toEqual([]);
  });
  it("distinguishes precise fen, explicit zero and unknown without changing whole-trip budget", () => {
    const { state, form } = input();
    form.slots.lunch.price = "1.10";
    form.slots.dinner.price = "0";
    const setup = buildMealForm(state, 0, form, recordedAt);
    expect(setup.days[0].entries.map((entry) => entry.meal.perPersonFen)).toEqual([
      110, 0,
    ]);
    expect(mealCostText(setup, 2)).toContain("¥1.10；2 餐费用未知");
    expect(state.budget.items.meals.amountFen).toBeNull();
    for (const price of ["-1", "1.001", "1e2", "Infinity", "100000.01"]) {
      form.slots.lunch.price = price;
      expect(() => buildMealForm(state, 0, form, recordedAt)).toThrow("餐费须为");
    }
  });
  it("preserves independent meal fact clocks when only position/window/stay changes", () => {
    const { state, form } = input();
    state.meals = buildMealForm(state, 0, form, recordedAt);
    const next = initialMealForm(state, 0);
    next.slots.lunch.stay = "45";
    next.slots.lunch.start = "2026-10-17T12:00";
    const changed = buildMealForm(state, 0, next, "2026-10-15T00:00:00Z");
    expect(changed.days[0].entries[0].id).toBe(state.meals.days[0].entries[0].id);
    expect(changed.days[0].entries[0].meal.source.recordedAt).toBe(recordedAt);
    next.slots.lunch.dietary = "user_checked";
    expect(
      buildMealForm(state, 0, next, "2026-10-15T00:00:00Z").days[0].entries[0].meal.source
        .recordedAt,
    ).toBe("2026-10-15T00:00:00Z");
  });
  it("does not transfer venue-specific opening/reservation evidence to a replacement", () => {
    const { state, form } = input();
    state.meals = buildMealForm(state, 0, form, recordedAt);
    const entry = state.meals.days[0].entries[0];
    entry.rules = {
      date: "2026-10-17",
      openingWindows: [],
      lastEntryMinute: null,
      reservation: { state: "not_required", entryWindow: null },
      source: { kind: "user", recordedAt },
    };
    const next = initialMealForm(state, 0);
    next.slots.lunch.place = structuredClone(places[2]);
    expect(buildMealForm(state, 0, next, recordedAt).days[0].entries[0].rules).toBeNull();
    entry.rules.reservation = {
      state: "confirmed",
      entryWindow: { startMinute: 690, endMinute: 720 },
    };
    expect(() => buildMealForm(state, 0, next, recordedAt)).toThrow("不能随替换静默移除");
    expect(entry.rules.reservation.state).toBe("confirmed");
  });
  it("accepts full next-day Shanghai windows and rejects invalid dates, stays and obsolete anchors", () => {
    const { state, form } = input();
    form.slots.dinner.start = "2026-10-18T00:15";
    form.slots.dinner.end = "2026-10-18T01:30";
    form.end = "2026-10-18T02:00";
    const setup = buildMealForm(state, 0, form, recordedAt);
    expect(setup.days[0].entries[1].window).toEqual({
      startMinute: 1455,
      endMinute: 1530,
    });
    expect(setup.days[0].endMinute).toBe(1560);
    form.slots.lunch.start = "2026-02-30T11:30";
    expect(() => buildMealForm(state, 0, form, recordedAt)).toThrow();
    form.slots.lunch.start = "2026-10-17T11:30";
    form.slots.lunch.stay = "";
    expect(() => buildMealForm(state, 0, form, recordedAt)).toThrow("停留须为");
    form.slots.lunch.stay = "60";
    form.slots.lunch.afterPlaceId = "missing";
    expect(() => buildMealForm(state, 0, form, recordedAt)).toThrow("插入位置已变化");
  });
  it("removes only the selected day, and same-POI instances keep separate selection keys", () => {
    const { state, form } = input();
    state.meals = buildMealForm(state, 0, form, recordedAt);
    const next = initialMealForm(state, 1);
    next.slots.lunch.place = places[0];
    next.slots.dinner.place = places[0];
    state.meals = buildMealForm(state, 1, next, recordedAt);
    expect(withoutMealDay(state, 0).days.map((day) => day.date)).toEqual(["2026-10-18"]);
    const stop = state.draft.days[0].items[0];
    expect(stopIdentity(stop)).toBe(places[0].id);
    expect(stopIdentity({ ...stop, activityId: next.slots.lunch.id })).not.toBe(
      stopIdentity({ ...stop, activityId: next.slots.dinner.id }),
    );
  });
  it("manual intercity transfers use the actual last dinner rather than the visit skeleton", () => {
    const { state } = input();
    const form = initialMealForm(state, 1);
    form.slots.lunch.place = structuredClone(places[0]);
    form.slots.dinner.place = { ...structuredClone(places[1]), id: "meal-destination" };
    state.meals = buildMealForm(state, 1, form, recordedAt);
    const intercity = initialIntercityForm(state);
    Object.assign(intercity.return, {
      enabled: true,
      origin: "测试站",
      destination: "终站",
      departure: "2026-10-18T23:00",
      arrival: "2026-10-19T07:00",
      buffer: "30",
      transfer: "20",
    });
    const result = buildIntercityForm(state, intercity, recordedAt);
    expect(result.connections.return?.fromId).toBe("meal-destination");
  });
});
