import { beforeEach, describe, expect, it } from "vitest";
import {
  changeItinerary,
  rescheduleItinerary,
  assertItineraryTimeLocks,
} from "@/domain/itinerary-editing";
import { itineraryChangeSchema, itinerarySchema } from "@/lib/itinerary-contracts";
import { useItineraryStore } from "@/features/itinerary/itinerary-store";
import { fixtureBrief, fixtureItinerary } from "../fixtures/itinerary";

const visit = "activity:trip-0-1";
const lunch = "activity:trip-0-2";
const current = () => useItineraryStore.getState();
beforeEach(() => {
  useItineraryStore.setState({ plan: null, review: null, previous: null, version: 0 });
});

describe("full-scale activity edits and protected times", () => {
  it("derives affected times without altering places, routes, target budgets or evidence clocks", () => {
    const before = fixtureItinerary();
    const copy = structuredClone(before);
    const after = changeItinerary(before, {
      kind: "duration",
      activityId: visit,
      stayMinutes: 90,
    });
    expect(before).toEqual(copy);
    expect(after.days[0].schedule!.items[1].endMinute).toBe(705);
    expect(after.days[0].schedule!.items[2].startMinute).toBe(735);
    expect(after.days[0].schedule!.items[4].startMinute).toBe(1020);
    expect(after.days[0].schedule!.legs).toEqual(before.days[0].schedule!.legs);
    expect(after.allocation).toEqual(before.allocation);
    expect(after.brief).toEqual(before.brief);
    expect(after.days[0].schedule!.items.map((item) => item.activity.place)).toEqual(
      before.days[0].schedule!.items.map((item) => item.activity.place),
    );
    expect(itinerarySchema.safeParse(after).success).toBe(true);
  });
  it.each([
    [1, 1],
    [14, 20],
  ])("edits a %i day, %i traveler plan without legacy limits", (dayCount, travelers) => {
    const brief = fixtureBrief();
    brief.dayCount = dayCount;
    brief.travelers = travelers;
    const before = fixtureItinerary(brief);
    const id = `activity:trip-${dayCount - 1}-1`;
    const after = changeItinerary(before, {
      kind: "duration",
      activityId: id,
      stayMinutes: 90,
    });
    expect(after.days).toHaveLength(dayCount);
    expect(after.brief.travelers).toBe(travelers);
    expect(after.days.at(-1)!.schedule!.items[1].activity.stayMinutes).toBe(90);
    expect(after.days.at(-1)!.schedule!.status).toBe("unverified");
  });
  it.each([0, 14, 241, 30.5, NaN])("rejects invalid stay length %s", (stayMinutes) => {
    expect(() =>
      changeItinerary(fixtureItinerary(), {
        kind: "duration",
        activityId: visit,
        stayMinutes,
      }),
    ).toThrow("15—240");
  });
  it("rejects missing, duplicated and unchanged targets", () => {
    const before = fixtureItinerary();
    expect(() =>
      changeItinerary(before, {
        kind: "duration",
        activityId: "activity:missing",
        stayMinutes: 90,
      }),
    ).toThrow("不存在");
    expect(() =>
      changeItinerary(before, { kind: "duration", activityId: visit, stayMinutes: 60 }),
    ).toThrow("没有变化");
    before.days[1].schedule!.items[1].activity.id = visit;
    expect(() =>
      changeItinerary(before, { kind: "duration", activityId: visit, stayMinutes: 90 }),
    ).toThrow("重复");
  });
  it("recomputes unknown timing rather than locking a fabricated start", () => {
    const before = fixtureItinerary();
    before.days[0].schedule!.legs[0].route = null;
    before.days[0].schedule!.items[1].startMinute = 615;
    expect(() =>
      changeItinerary(before, { kind: "time_lock", activityId: visit, locked: true }),
    ).toThrow("不能锁定未知");
    const after = changeItinerary(before, {
      kind: "duration",
      activityId: visit,
      stayMinutes: 90,
    });
    expect(
      after.days[0].schedule!.items.slice(1).every((item) => item.startMinute === null),
    ).toBe(true);
  });
  it("detects a later time-lock conflict and cannot restore feasibility by clearing reports", () => {
    const locked = changeItinerary(fixtureItinerary(), {
      kind: "time_lock",
      activityId: lunch,
      locked: true,
    });
    const after = changeItinerary(locked, {
      kind: "duration",
      activityId: visit,
      stayMinutes: 90,
    });
    expect(after.status).toBe("infeasible");
    after.status = "unverified";
    after.days[0].schedule!.issues = [];
    after.days[0].schedule!.status = "unverified";
    expect(rescheduleItinerary(after).status).toBe("infeasible");
  });
  it("will not allow a generated replacement to remove a time lock or swap its day, kind or coordinates", () => {
    const before = changeItinerary(fixtureItinerary(), {
      kind: "time_lock",
      activityId: visit,
      locked: true,
    });
    expect(() => assertItineraryTimeLocks(before, before)).not.toThrow();
    for (const mutate of [
      (plan: typeof before) => {
        plan.days[0].schedule!.items[1].activity.fixedStartMinute = null;
      },
      (plan: typeof before) => {
        plan.days[0].schedule!.items[1].activity.place.location = [120.3, 30.3];
      },
      (plan: typeof before) => {
        plan.days[0].schedule!.items[1].activity.kind = "lunch";
      },
      (plan: typeof before) => {
        plan.days[0].date = "2027-01-01";
      },
    ]) {
      const after = structuredClone(before);
      mutate(after);
      expect(() => assertItineraryTimeLocks(before, after)).toThrow();
    }
  });
  it("only an explicit unlock operation releases the same bound activity", () => {
    const before = changeItinerary(fixtureItinerary(), {
      kind: "time_lock",
      activityId: visit,
      locked: true,
    });
    const after = changeItinerary(before, {
      kind: "time_lock",
      activityId: visit,
      locked: false,
    });
    expect(() => assertItineraryTimeLocks(before, after)).toThrow("时间锁");
    expect(() => assertItineraryTimeLocks(before, after, visit)).not.toThrow();
    after.days[0].schedule!.items[1].activity.place.id = "different-poi";
    expect(() => assertItineraryTimeLocks(before, after, visit)).toThrow("对象已变化");
  });
  it("does not silently delete recorded reservations on whole-plan replacement", () => {
    const before = fixtureItinerary();
    before.days[0].schedule!.items[1].activity.rules = {
      date: before.days[0].date,
      openingWindows: null,
      lastEntryMinute: null,
      reservation: {
        state: "confirmed",
        entryWindow: { startMinute: 600, endMinute: 660 },
      },
      source: { kind: "user", recordedAt: before.generatedAt },
    };
    const after = structuredClone(before);
    after.days[0].schedule!.items[1].activity.rules = null;
    expect(() => assertItineraryTimeLocks(before, after)).toThrow("已记录预约");
  });
  it("strictly rejects injected permissions and pricing fields in edit operations", () => {
    expect(
      itineraryChangeSchema.safeParse({
        kind: "duration",
        activityId: visit,
        stayMinutes: 90,
        perPersonFen: 0,
      }).success,
    ).toBe(false);
    expect(
      itineraryChangeSchema.safeParse({
        kind: "time_lock",
        activityId: visit,
        locked: false,
        releaseReservations: true,
      }).success,
    ).toBe(false);
  });
});

describe("full-scale position locks", () => {
  it.each([1, 14])(
    "locks a day %i activity even if its estimated start is unknown, without changing routes or time locks",
    (dayCount) => {
      const brief = fixtureBrief();
      brief.dayCount = dayCount;
      brief.travelers = 20;
      const before = fixtureItinerary(brief);
      before.days.at(-1)!.schedule!.legs[0].route = null;
      const copy = structuredClone(before);
      const id = `activity:trip-${dayCount - 1}-1`;
      const after = changeItinerary(before, {
        kind: "position_lock",
        activityId: id,
        locked: true,
      });
      const target = after.days.at(-1)!.schedule!.items[1];
      expect(target.activity.positionLocked).toBe(true);
      expect(target.startMinute).toBeNull();
      expect(target.activity.fixedStartMinute).toBeNull();
      expect(after.days.at(-1)!.schedule!.legs).toEqual(copy.days.at(-1)!.schedule!.legs);
      expect(before).toEqual(copy);
      expect(itinerarySchema.safeParse(after).success).toBe(true);
    },
  );
  it("rejects no-op position locks and injected release or replacement permissions", () => {
    expect(() =>
      changeItinerary(fixtureItinerary(), {
        kind: "position_lock",
        activityId: visit,
        locked: false,
      }),
    ).toThrow("没有变化");
    expect(
      itineraryChangeSchema.safeParse({
        kind: "position_lock",
        activityId: visit,
        locked: false,
        releaseReservations: true,
      }).success,
    ).toBe(false);
    expect(
      itineraryChangeSchema.safeParse({
        kind: "position_lock",
        activityId: visit,
        locked: "false",
      }).success,
    ).toBe(false);
  });
  it("protects the bound place, date, ordinal and lock from generated replacement", () => {
    const before = changeItinerary(fixtureItinerary(), {
      kind: "position_lock",
      activityId: visit,
      locked: true,
    });
    expect(() => assertItineraryTimeLocks(before, before)).not.toThrow();
    for (const mutate of [
      (plan: typeof before) => {
        plan.days[0].schedule!.items[1].activity.positionLocked = false;
      },
      (plan: typeof before) => {
        plan.days[0].schedule!.items.reverse();
      },
      (plan: typeof before) => {
        plan.days[0].date = "2027-01-01";
      },
      (plan: typeof before) => {
        plan.days[0].schedule!.items[1].activity.place.id = "changed";
      },
      (plan: typeof before) => {
        plan.days[0].schedule!.items[1].activity.place.location = [120.3, 30.3];
      },
    ]) {
      const after = structuredClone(before);
      mutate(after);
      expect(() => assertItineraryTimeLocks(before, after)).toThrow();
    }
  });
  it("position release cannot clear a time lock or reservation and is bound to its target", () => {
    let before = changeItinerary(fixtureItinerary(), {
      kind: "position_lock",
      activityId: visit,
      locked: true,
    });
    before = changeItinerary(before, {
      kind: "time_lock",
      activityId: visit,
      locked: true,
    });
    const after = changeItinerary(before, {
      kind: "position_lock",
      activityId: visit,
      locked: false,
    });
    expect(() => assertItineraryTimeLocks(before, after, undefined, lunch)).toThrow(
      "位置锁",
    );
    expect(() => assertItineraryTimeLocks(before, after, undefined, visit)).not.toThrow();
    after.days[0].schedule!.items[1].activity.fixedStartMinute = null;
    expect(() => assertItineraryTimeLocks(before, after, undefined, visit)).toThrow(
      "时间锁",
    );
  });
  it("rejects cross-day activity aliases even when each day's directed legs and recommendations are consistent", () => {
    const plan = fixtureItinerary();
    const day = plan.days[1];
    const old = day.schedule!.items[1].activity.id;
    day.schedule!.items[1].activity.id = visit;
    for (const leg of day.schedule!.legs) {
      if (leg.fromActivityId === old) {
        leg.fromActivityId = visit;
      }
      if (leg.toActivityId === old) {
        leg.toActivityId = visit;
      }
    }
    day.recommendations = day.recommendations.map((entry) =>
      entry.activityId === old ? { ...entry, activityId: visit } : entry,
    );
    const parsed = itinerarySchema.safeParse(plan);
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(
        parsed.error.issues.some((issue) => issue.message.includes("全程唯一")),
      ).toBe(true);
    }
  });
  it("previews, cancels, confirms, guards generation and explicitly unlocks with version-increasing undo", () => {
    current().receive(fixtureItinerary(), 0);
    const before = current().plan;
    current().proposeChange({ kind: "position_lock", activityId: visit, locked: true });
    expect(current().plan).toBe(before);
    current().cancelReview();
    expect(current().version).toBe(1);
    current().proposeChange({ kind: "position_lock", activityId: visit, locked: true });
    current().confirm();
    expect(current().version).toBe(2);
    current().receive(fixtureItinerary(), 2);
    expect(() => current().confirm()).toThrow("位置锁");
    expect(current().version).toBe(2);
    current().cancelReview();
    current().proposeChange({ kind: "duration", activityId: visit, stayMinutes: 90 });
    current().confirm();
    expect(current().plan!.days[0].schedule!.items[1].activity.positionLocked).toBe(true);
    current().proposeChange({ kind: "position_lock", activityId: visit, locked: false });
    current().confirm();
    expect(current().plan!.days[0].schedule!.items[1].activity.positionLocked).toBe(
      false,
    );
    current().undo();
    expect(current().plan!.days[0].schedule!.items[1].activity.positionLocked).toBe(true);
    expect(current().version).toBe(5);
  });
});

describe("versioned full-plan edit proposals", () => {
  it("previews, confirms and undoes an activity edit with monotonically increasing versions", () => {
    current().receive(fixtureItinerary(), 0);
    const before = current().plan;
    current().proposeChange({ kind: "duration", activityId: visit, stayMinutes: 90 });
    expect(current().plan).toBe(before);
    expect(current().version).toBe(1);
    expect(current().review!.plan.days[0].schedule!.items[1].activity.stayMinutes).toBe(
      90,
    );
    current().confirm();
    expect(current().version).toBe(2);
    expect(current().plan!.days[0].schedule!.items[1].activity.stayMinutes).toBe(90);
    current().undo();
    expect(current().version).toBe(3);
    expect(current().plan).toBe(before);
  });
  it("recomputes from the current snapshot instead of trusting candidate timestamps or reports", () => {
    current().receive(fixtureItinerary(), 0);
    current().proposeChange({ kind: "duration", activityId: visit, stayMinutes: 90 });
    current().review!.plan.days[0].schedule!.items[1].startMinute = 0;
    current().review!.plan.days[0].schedule!.items[1].activity.stayMinutes = 15;
    current().confirm();
    expect(current().plan!.days[0].schedule!.items[1].startMinute).toBe(615);
    expect(current().plan!.days[0].schedule!.items[1].activity.stayMinutes).toBe(90);
  });
  it("refuses stale, stacked and conflicting local proposals without overwriting current content", () => {
    current().receive(fixtureItinerary(), 0);
    const before = current().plan;
    current().proposeChange({ kind: "duration", activityId: visit, stayMinutes: 90 });
    expect(() =>
      current().proposeChange({ kind: "duration", activityId: visit, stayMinutes: 120 }),
    ).toThrow("先确认或取消");
    useItineraryStore.setState({ version: 2 });
    expect(() => current().confirm()).toThrow("已变化");
    expect(current().plan).toBe(before);
    current().cancelReview();
    useItineraryStore.setState({ version: 1 });
    current().proposeChange({ kind: "time_lock", activityId: lunch, locked: true });
    current().confirm();
    const locked = current().plan;
    current().proposeChange({ kind: "duration", activityId: visit, stayMinutes: 90 });
    current().review!.plan.status = "unverified";
    current().review!.plan.days[0].schedule!.issues = [];
    current().review!.plan.days[0].schedule!.status = "unverified";
    expect(() => current().confirm()).toThrow();
    expect(current().plan).toBe(locked);
  });
  it("protects time locks from generation while allowing an explicit versioned unlock and undo", () => {
    current().receive(fixtureItinerary(), 0);
    current().proposeChange({ kind: "time_lock", activityId: visit, locked: true });
    current().confirm();
    current().receive(fixtureItinerary(), 2);
    expect(() => current().confirm()).toThrow("时间锁");
    current().cancelReview();
    current().proposeChange({ kind: "time_lock", activityId: visit, locked: false });
    current().confirm();
    expect(
      current().plan!.days[0].schedule!.items[1].activity.fixedStartMinute,
    ).toBeNull();
    current().undo();
    expect(current().plan!.days[0].schedule!.items[1].activity.fixedStartMinute).toBe(
      615,
    );
    expect(current().version).toBe(4);
  });
});
