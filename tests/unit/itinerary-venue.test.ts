import { beforeEach, describe, expect, it } from "vitest";
import {
  changeItinerary,
  itineraryRuleRelease,
  assertItineraryTimeLocks,
  type ItineraryChange,
} from "@/domain/itinerary-editing";
import type { VenueRules } from "@/domain/meal-planning";
import { itinerarySchema, itineraryChangeSchema } from "@/lib/itinerary-contracts";
import { useItineraryStore } from "@/features/itinerary/itinerary-store";
import { fixtureBrief, fixtureItinerary } from "../fixtures/itinerary";

const id = "activity:trip-0-1";
const state = () => useItineraryStore.getState();
const rules = (date = fixtureItinerary().days[0].date): VenueRules => ({
  date,
  openingWindows: [{ startMinute: 540, endMinute: 1200 }],
  lastEntryMinute: null,
  reservation: { state: "unknown", entryWindow: null },
  source: { kind: "user", recordedAt: "2026-10-28T01:00:00Z" },
});
const change = (
  value: VenueRules | null,
  activityId = id,
): Extract<ItineraryChange, { kind: "venue_rules" }> => ({
  kind: "venue_rules",
  activityId,
  rules: value,
  reservationRelease: null,
});
const booked = () => {
  const record = rules();
  record.reservation = {
    state: "confirmed",
    entryWindow: { startMinute: 615, endMinute: 660 },
  };
  return changeItinerary(fixtureItinerary(), change(record));
};
beforeEach(() => {
  useItineraryStore.setState({ plan: null, review: null, previous: null, version: 0 });
});

describe("full itinerary user venue rules", () => {
  it.each([0, 1, 2, 4])(
    "records rules for visit or meal activity %i without changing meals, budgets, directions or evidence clocks",
    (index) => {
      const before = fixtureItinerary();
      const copy = structuredClone(before);
      const after = changeItinerary(before, change(rules(), `activity:trip-0-${index}`));
      expect(before).toEqual(copy);
      expect(after.days[0].schedule!.items[index].activity.rules).toEqual(rules());
      expect(after.days[0].schedule!.items[index].activity.meal).toEqual(
        before.days[0].schedule!.items[index].activity.meal,
      );
      expect(after.days[0].schedule!.legs).toEqual(before.days[0].schedule!.legs);
      expect(after.allocation).toEqual(before.allocation);
      expect(after.generatedAt).toBe(before.generatedAt);
      expect(itinerarySchema.safeParse(after).success).toBe(true);
    },
  );
  it("supports the fourteenth day's date for twenty people, not a legacy three-day cap", () => {
    const brief = fixtureBrief();
    brief.dayCount = 14;
    brief.travelers = 20;
    const before = fixtureItinerary(brief);
    const record = rules(before.days[13].date);
    const after = changeItinerary(before, change(record, "activity:trip-13-1"));
    expect(after.days[13].schedule!.items[1].activity.rules).toEqual(record);
    expect(after.days).toHaveLength(14);
    expect(after.status).toBe("unverified");
  });
  it("keeps null unknown, explicit closed and incomplete opening coverage distinct", () => {
    const closed = rules();
    closed.openingWindows = [];
    expect(changeItinerary(fixtureItinerary(), change(closed)).status).toBe("infeasible");
    const short = rules();
    short.openingWindows = [{ startMinute: 600, endMinute: 630 }];
    expect(changeItinerary(fixtureItinerary(), change(short)).status).toBe("infeasible");
    const unknown = rules();
    unknown.openingWindows = null;
    expect(changeItinerary(fixtureItinerary(), change(unknown)).status).toBe(
      "unverified",
    );
  });
  it("uses reservation windows for entry only and refuses the exclusive end or wrong reservation date", () => {
    expect(booked().status).toBe("unverified");
    const end = rules();
    end.reservation = {
      state: "confirmed",
      entryWindow: { startMinute: 600, endMinute: 615 },
    };
    const fixed = changeItinerary(fixtureItinerary(), {
      kind: "time_lock",
      activityId: id,
      locked: true,
    });
    expect(changeItinerary(fixed, change(end)).status).toBe("infeasible");
    end.date = "2027-01-01";
    expect(changeItinerary(fixtureItinerary(), change(end)).status).toBe("infeasible");
  });
  it("rejects no-op facts and timestamp-only refreshes rather than relabeling their source clock", () => {
    const before = changeItinerary(fixtureItinerary(), change(rules()));
    const same = rules();
    same.source.recordedAt = "2026-10-29T00:00:00Z";
    expect(() => changeItinerary(before, change(same))).toThrow("没有变化");
    expect(() => changeItinerary(fixtureItinerary(), change(null))).toThrow("没有变化");
    expect(before.days[0].schedule!.items[1].activity.rules!.source.recordedAt).toBe(
      "2026-10-28T01:00:00Z",
    );
  });
  it("requires exact before/after-bound acknowledgement for a confirmed reservation change or removal", () => {
    const before = booked();
    const required = itineraryRuleRelease(before, id, null)!;
    expect(required).not.toBeNull();
    expect(() => changeItinerary(before, change(null))).toThrow("原预约为强约束");
    for (const release of [
      { ...required, activityId: "activity:other" },
      { ...required, beforeKey: "old" },
      { ...required, afterKey: "unrelated" },
    ]) {
      expect(() =>
        changeItinerary(before, { ...change(null), reservationRelease: release }),
      ).toThrow("核对与当前修改不一致");
    }
    const after = changeItinerary(before, {
      ...change(null),
      reservationRelease: required,
    });
    expect(after.days[0].schedule!.items[1].activity.rules).toBeNull();
    expect(() => assertItineraryTimeLocks(before, after)).toThrow("已记录预约");
    expect(() =>
      assertItineraryTimeLocks(before, after, undefined, undefined, false, id),
    ).not.toThrow();
    expect(() =>
      changeItinerary(fixtureItinerary(), {
        ...change(rules()),
        reservationRelease: required,
      }),
    ).toThrow("核对与当前修改不一致");
  });
  it("does not require appointment release for opening-only edits and binds acknowledgement to the actual current time lock", () => {
    const before = booked();
    const opening = structuredClone(before.days[0].schedule!.items[1].activity.rules!);
    opening.openingWindows = [{ startMinute: 540, endMinute: 1140 }];
    opening.source.recordedAt = "2026-10-29T00:00:00Z";
    expect(itineraryRuleRelease(before, id, opening)).toBeNull();
    const after = changeItinerary(before, change(opening));
    expect(() => assertItineraryTimeLocks(before, after)).not.toThrow();
    const required = itineraryRuleRelease(before, id, null)!;
    const timed = changeItinerary(before, {
      kind: "time_lock",
      activityId: id,
      locked: true,
    });
    expect(() =>
      changeItinerary(timed, { ...change(null), reservationRelease: required }),
    ).toThrow("核对与当前修改不一致");
    const unlocked = changeItinerary(timed, {
      kind: "time_lock",
      activityId: id,
      locked: false,
    });
    expect(() => assertItineraryTimeLocks(timed, unlocked, id)).not.toThrow();
    expect(unlocked.days[0].schedule!.items[1].activity.rules).toEqual(
      timed.days[0].schedule!.items[1].activity.rules,
    );
  });
  it("strictly rejects fabricated supplier rules, release permissions, missing acknowledgement fields or unrelated prices", () => {
    expect(
      itineraryChangeSchema.safeParse({ ...change(rules()), perPersonFen: 0 }).success,
    ).toBe(false);
    expect(
      itineraryChangeSchema.safeParse({
        ...change(rules()),
        rules: {
          ...rules(),
          source: { kind: "provider", recordedAt: "2026-10-28T01:00:00Z" },
        },
      }).success,
    ).toBe(false);
    expect(
      itineraryChangeSchema.safeParse({
        ...change(rules()),
        reservationRelease: { activityId: id, beforeKey: "x" },
      }).success,
    ).toBe(false);
  });
});

describe("versioned venue rule previews", () => {
  it("previews, cancels, confirms and undoes without changing price, source or route data", () => {
    state().receive(fixtureItinerary(), 0);
    const before = state().plan;
    state().proposeChange(change(rules()));
    expect(state().plan).toBe(before);
    state().cancelReview();
    expect(state().version).toBe(1);
    state().proposeChange(change(rules()));
    state().confirm();
    expect(state().version).toBe(2);
    expect(state().plan!.days[0].schedule!.items[1].activity.rules).toEqual(rules());
    state().undo();
    expect(state().plan).toBe(before);
    expect(state().version).toBe(3);
  });
  it("recomputes known conflicts despite edited candidate reports and rejects a stale rule edit", () => {
    state().receive(fixtureItinerary(), 0);
    const before = state().plan;
    const closed = rules();
    closed.openingWindows = [];
    state().proposeChange(change(closed));
    state().review!.plan.status = "unverified";
    state().review!.plan.days[0].schedule!.status = "unverified";
    state().review!.plan.days[0].schedule!.issues = [];
    expect(() => state().confirm()).toThrow("冲突");
    expect(state().plan).toBe(before);
    useItineraryStore.setState({ version: 2 });
    expect(() => state().confirm()).toThrow("已变化");
  });
  it("validates acknowledgement again at confirmation and can explicitly remove then undo a recorded reservation", () => {
    const before = booked();
    state().receive(before, 0);
    const release = itineraryRuleRelease(before, id, null)!;
    state().proposeChange({ ...change(null), reservationRelease: release });
    const operation = state().review!.change;
    if (operation?.kind !== "venue_rules") {
      throw new Error("missing rule proposal");
    }
    operation.reservationRelease = null;
    expect(() => state().confirm()).toThrow("原预约为强约束");
    state().cancelReview();
    state().proposeChange({ ...change(null), reservationRelease: release });
    state().confirm();
    expect(state().plan!.days[0].schedule!.items[1].activity.rules).toBeNull();
    expect(state().version).toBe(2);
    state().undo();
    expect(
      state().plan!.days[0].schedule!.items[1].activity.rules!.reservation.state,
    ).toBe("confirmed");
    expect(state().version).toBe(3);
  });
});
