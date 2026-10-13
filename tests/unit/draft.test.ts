import { describe, expect, it } from "vitest";
import { addDays, formatMinute, groupPlaces, makeDay, makeDraft } from "@/domain/draft";
import { draftSchema, tripInputSchema } from "@/lib/contracts";
import { fixtureDraft, input, places, route } from "../fixtures/draft";

describe("draft domain and contracts", () => {
  it("balances days while preserving user order", () => {
    const groups = groupPlaces(places, 3);
    expect(groups.map((g) => g.length)).toEqual([2, 1, 1]);
    expect(groups.flat().map((p) => p.id)).toEqual(places.map((p) => p.id));
  });
  it("handles calendar rollover", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  });
  it("includes real travel duration and separate user buffer", () => {
    const day = makeDay(
      input.startDate,
      places.slice(0, 2),
      [{ fromId: places[0].id, toId: places[1].id, route, error: null }],
      90,
      15,
    );
    expect(day.items[1].startMinute).toBe(9 * 60 + 90 + 20 + 15);
  });
  it("unknown travel does not become zero or a fabricated time", () => {
    const day = makeDay(
      input.startDate,
      places.slice(0, 3),
      [
        { fromId: "a", toId: "b", route: null, error: "fixture failure" },
        { fromId: "b", toId: "c", route, error: null },
      ],
      90,
      15,
    );
    expect(day.items[1].startMinute).toBeNull();
    expect(day.items[2].startMinute).toBeNull();
    expect(day.issues).not.toHaveLength(0);
  });
  it("reports conflict rather than marking an incomplete draft feasible", () => {
    const day = makeDay(input.startDate, places, [], 240, 0);
    const longLeg = {
      fromId: "a",
      toId: "b",
      route: { ...route, seconds: 600 },
      error: null,
    };
    const conflict = makeDay(
      input.startDate,
      places,
      [longLeg, longLeg, longLeg],
      240,
      0,
    );
    expect(makeDraft(input, [day], []).status).toBe("unverified");
    expect(makeDraft(input, [conflict], []).status).toBe("infeasible");
  });
  it("formats times beyond midnight without losing the day", () => {
    expect(formatMinute(1500)).toBe("次日 +1 01:00");
    expect(formatMinute(null)).toBe("待校验");
  });
  it("rejects invalid dates, duplicate names, too many places and fractional fen", () => {
    for (const invalid of [
      { ...input, startDate: "2026-02-30" },
      { ...input, keywords: ["同一地点", "同一地点"] },
      { ...input, keywords: Array.from({ length: 7 }, (_, i) => String(i)) },
      { ...input, budgetPerPersonFen: 1.5 },
    ]) {
      expect(tripInputSchema.safeParse(invalid).success).toBe(false);
    }
  });
  it("validates the authored draft fixture", () => {
    expect(draftSchema.safeParse(fixtureDraft()).success).toBe(true);
  });
});
