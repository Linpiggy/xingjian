import { describe, expect, it } from "vitest";
import { createEditState } from "@/domain/editing";
import {
  buildMealForm,
  initialMealForm,
  withoutMealDay,
} from "@/features/planner/meal-form";
import { buildVenueRules, initialVenueFields } from "@/features/planner/venue-form";
import { fixtureDraft, places } from "../fixtures/draft";

const date = "2026-10-17";
const recordedAt = "2026-10-14T01:00:00Z";
const later = "2026-10-15T02:00:00Z";
function fields() {
  return initialVenueFields(null, date, places[0]);
}
function populated() {
  const state = createEditState(fixtureDraft(), "venue-fixture");
  const form = initialMealForm(state, 0);
  form.slots.lunch.place = places[0];
  form.slots.dinner.place = places[1];
  form.slots.lunch.venue = fields();
  form.slots.lunch.venue.enabled = true;
  return { state, form };
}
describe("user-recorded venue form facts, not merchant verification", () => {
  it("separates no record, unknown opening, and explicit closed without inventing windows", () => {
    const form = fields();
    expect(buildVenueRules(form, places[0], null, recordedAt)).toBeNull();
    form.enabled = true;
    const unknown = buildVenueRules(form, places[0], null, recordedAt)!;
    expect(unknown.openingWindows).toBeNull();
    expect(unknown.lastEntryMinute).toBeNull();
    expect(unknown.reservation).toEqual({ state: "unknown", entryWindow: null });
    form.opening = "closed";
    expect(buildVenueRules(form, places[0], unknown, later)?.openingWindows).toEqual([]);
    form.opening = "windows";
    expect(() => buildVenueRules(form, places[0], null, recordedAt)).toThrow(
      "至少填写一段",
    );
  });
  it("preserves complete Shanghai dates across a year and treats reservation windows as entry windows", () => {
    const form = fields();
    Object.assign(form, {
      enabled: true,
      date: "2026-12-31",
      opening: "windows",
      windows: [{ start: "2026-12-31T23:00", end: "2027-01-01T02:00" }],
      lastEntry: "2027-01-01T01:00",
      reservation: "confirmed",
      entryStart: "2027-01-01T00:15",
      entryEnd: "2027-01-01T00:45",
    });
    const result = buildVenueRules(form, places[0], null, recordedAt)!;
    expect(result.openingWindows).toEqual([{ startMinute: 1380, endMinute: 1560 }]);
    expect(result.lastEntryMinute).toBe(1500);
    expect(result.reservation.entryWindow).toEqual({
      startMinute: 1455,
      endMinute: 1485,
    });
    expect(result.source).toEqual({ kind: "user", recordedAt });
    expect(form.windows[0].end).toBe("2027-01-01T02:00");
  });
  it("rejects incomplete, invalid or out-of-range facts rather than silently clearing them", () => {
    const form = fields();
    form.enabled = true;
    form.reservation = "confirmed";
    form.entryStart = "2026-10-17T12:00";
    expect(() => buildVenueRules(form, places[0], null, recordedAt)).toThrow("同时填写");
    form.entryEnd = "2026-10-17T11:00";
    expect(() => buildVenueRules(form, places[0], null, recordedAt)).toThrow();
    form.entryStart = "";
    form.entryEnd = "";
    expect(
      buildVenueRules(form, places[0], null, recordedAt)?.reservation.entryWindow,
    ).toBeNull();
    form.lastEntry = "2026-02-30T12:00";
    expect(() => buildVenueRules(form, places[0], null, recordedAt)).toThrow(
      "营业／预约上海日期时间",
    );
    form.lastEntry = "2026-10-16T23:59";
    expect(() => buildVenueRules(form, places[0], null, recordedAt)).toThrow();
    form.lastEntry = "2026-10-17T00:00";
    expect(buildVenueRules(form, places[0], null, recordedAt)?.lastEntryMinute).toBe(0);
    form.opening = "windows";
    form.windows = Array.from({ length: 9 }, () => ({
      start: "2026-10-17T08:00",
      end: "2026-10-17T20:00",
    }));
    expect(() => buildVenueRules(form, places[0], null, recordedAt)).toThrow();
  });
  it("keeps venue and meal provenance clocks independent, and does not refresh unchanged facts", () => {
    const { state, form } = populated();
    state.meals = buildMealForm(state, 0, form, recordedAt);
    const before = structuredClone(state);
    const next = initialMealForm(state, 0);
    next.slots.lunch.price = "1.10";
    const priceChanged = buildMealForm(state, 0, next, later);
    expect(priceChanged.days[0].entries[0].rules?.source.recordedAt).toBe(recordedAt);
    expect(priceChanged.days[0].entries[0].meal.source.recordedAt).toBe(later);
    next.slots.lunch.price = "";
    next.slots.lunch.venue.reservation = "not_required";
    const ruleChanged = buildMealForm(state, 0, next, later);
    expect(ruleChanged.days[0].entries[0].rules?.source.recordedAt).toBe(later);
    expect(ruleChanged.days[0].entries[0].meal.source.recordedAt).toBe(recordedAt);
    expect(state).toEqual(before);
  });
  it("does not transfer old facts to a new POI or changed coordinates", () => {
    const form = fields();
    form.enabled = true;
    form.opening = "closed";
    expect(buildVenueRules(form, places[1], null, recordedAt)).toBeNull();
    expect(
      buildVenueRules(form, { ...places[0], location: [120, 30] }, null, recordedAt),
    ).toBeNull();
  });
  it("requires explicit acknowledgement before changing or removing a recorded reservation", () => {
    const { state, form } = populated();
    form.slots.lunch.venue.reservation = "confirmed";
    state.meals = buildMealForm(state, 0, form, recordedAt);
    const next = initialMealForm(state, 0);
    next.slots.lunch.venue.enabled = false;
    expect(() => buildMealForm(state, 0, next, later)).toThrow("原预约为强约束");
    expect(() => withoutMealDay(state, 0)).toThrow("先明确核对");
    next.slots.lunch.venue.releaseConfirmed = true;
    expect(buildMealForm(state, 0, next, later).days[0].entries[0].rules).toBeNull();
    expect(withoutMealDay(state, 0, true).days).toEqual([]);
    expect(state.meals.days[0].entries[0].rules?.reservation.state).toBe("confirmed");
  });
});
