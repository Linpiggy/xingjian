import { beforeEach, describe, expect, it } from "vitest";
import { changeItinerary, assertItineraryTimeLocks } from "@/domain/itinerary-editing";
import {
  prepareItineraryMove,
  itineraryEdgeKey,
  type ItineraryMove,
} from "@/domain/itinerary-moves";
import { itinerarySchema, itineraryChangeSchema } from "@/lib/itinerary-contracts";
import { useItineraryStore } from "@/features/itinerary/itinerary-store";
import { fixtureBrief, fixtureItinerary } from "../fixtures/itinerary";
import { route } from "../fixtures/draft";

const move: ItineraryMove = {
  kind: "move",
  activityId: "activity:trip-0-1",
  toDay: 0,
  toIndex: 3,
};
const state = () => useItineraryStore.getState();
const results = (plan = fixtureItinerary(), operation = move) =>
  prepareItineraryMove(plan, operation).gaps.map((gap) => ({
    ...gap,
    route: structuredClone(route),
  }));
beforeEach(() => {
  useItineraryStore.setState({ plan: null, review: null, previous: null, version: 0 });
});

describe("full-scale directed local moves", () => {
  it("preserves explicit order and unchanged edges, requires only three actual new neighbors, and never mutates its input", () => {
    const before = fixtureItinerary();
    const copy = structuredClone(before);
    const prepared = prepareItineraryMove(before, move);
    expect(prepared.gaps).toHaveLength(3);
    expect(prepared.missing).toHaveLength(3);
    expect(new Set(prepared.gaps.map(itineraryEdgeKey)).size).toBe(3);
    const after = changeItinerary(before, move);
    expect(before).toEqual(copy);
    expect(after.days[0].schedule!.items.map((item) => item.activity.id)).toEqual([
      "activity:trip-0-0",
      "activity:trip-0-2",
      "activity:trip-0-3",
      "activity:trip-0-1",
      "activity:trip-0-4",
    ]);
    expect(after.days[0].schedule!.legs[1].route).toEqual(
      before.days[0].schedule!.legs[2].route,
    );
    expect(after.days[0].schedule!.items[1].startMinute).toBeNull();
    expect(after.brief).toEqual(before.brief);
    expect(after.allocation).toEqual(before.allocation);
    expect(after.generatedAt).toBe(before.generatedAt);
    expect(itinerarySchema.safeParse(after).success).toBe(true);
  });
  it("partial results leave only unqueried edges; complete results derive all times from actual directed neighbors", () => {
    const before = fixtureItinerary();
    const routes = results(before);
    expect(prepareItineraryMove(before, move, routes.slice(0, 1)).missing).toEqual(
      prepareItineraryMove(before, move).gaps.slice(1),
    );
    const after = changeItinerary(before, move, routes);
    expect(after.days[0].schedule!.items[3].startMinute).toBe(825);
    expect(after.days[0].schedule!.items[4].startMinute).toBe(1020);
    expect(after.status).toBe("unverified");
    expect(prepareItineraryMove(before, move, routes).missing).toHaveLength(0);
  });
  it("moves to day fourteen for twenty travelers with target availability, stable instance, explanation and provenance", () => {
    const brief = fixtureBrief();
    brief.dayCount = 14;
    brief.travelers = 20;
    brief.availability.lastDayEndMinute = 1200;
    const before = fixtureItinerary(brief);
    const operation = { ...move, toDay: 13 };
    const after = changeItinerary(before, operation, results(before, operation));
    const item = after.days[13].schedule!.items[3];
    expect(
      after.days[0].schedule!.items.some((item) => item.activity.id === move.activityId),
    ).toBe(false);
    expect(item.activity.id).toBe(move.activityId);
    expect(item.activity.window).toEqual({ startMinute: 540, endMinute: 1200 });
    expect(item.activity.place).toEqual(before.days[0].schedule!.items[1].activity.place);
    expect(
      after.days[13].recommendations.find(
        (entry) => entry.activityId === move.activityId,
      ),
    ).toEqual(before.days[0].recommendations[1]);
    expect(
      after.days[0].recommendations.some((entry) => entry.activityId === move.activityId),
    ).toBe(false);
    expect(itinerarySchema.safeParse(after).success).toBe(true);
  });
  it.each([
    { ...move, toDay: -1 },
    { ...move, toDay: 14 },
    { ...move, toDay: 0.5 },
    { ...move, toIndex: -1 },
    { ...move, toIndex: 8 },
    { ...move, toIndex: 1.2 },
  ])("rejects invalid move boundaries $toDay / $toIndex", (operation) => {
    expect(() => changeItinerary(fixtureItinerary(), operation)).toThrow();
    expect(itineraryChangeSchema.safeParse(operation).success).toBe(false);
  });
  it("rejects no-op, absent, duplicate and meal targets and unavailable days", () => {
    expect(() => changeItinerary(fixtureItinerary(), { ...move, toIndex: 1 })).toThrow(
      "没有变化",
    );
    expect(() =>
      changeItinerary(fixtureItinerary(), { ...move, activityId: "activity:missing" }),
    ).toThrow("不存在");
    expect(() =>
      changeItinerary(fixtureItinerary(), { ...move, activityId: "activity:trip-0-0" }),
    ).toThrow("餐次");
    const duplicate = fixtureItinerary();
    duplicate.days[1].schedule!.items[1].activity.id = move.activityId;
    expect(() => changeItinerary(duplicate, move)).toThrow("重复");
    const unavailable = fixtureItinerary();
    unavailable.days[1].schedule = null;
    expect(() => changeItinerary(unavailable, { ...move, toDay: 1 })).toThrow("没有可用");
    expect(
      itineraryChangeSchema.safeParse({ ...move, releaseReservations: true }).success,
    ).toBe(false);
  });
  it("rejects reversed, wrong-coordinate, unrelated and duplicate responses without relabeling them as new routes", () => {
    const before = fixtureItinerary();
    const valid = results(before);
    for (const invalid of [
      {
        ...valid[0],
        fromActivityId: valid[0].toActivityId,
        toActivityId: valid[0].fromActivityId,
      },
      { ...valid[0], origin: [120.3, 30.3] as [number, number] },
      { ...valid[0], toActivityId: "activity:unrelated" },
    ]) {
      expect(() => changeItinerary(before, move, [invalid])).toThrow("不一致");
    }
    expect(() => changeItinerary(before, move, [valid[0], valid[0]])).toThrow("不一致");
    const user = structuredClone(valid[0]);
    user.route.source = {
      kind: "user",
      provider: "user",
      queriedAt: before.generatedAt,
      coordinateSystem: "GCJ-02",
    };
    expect(() => changeItinerary(before, move, [user])).toThrow("来源");
    before.fixture = false;
    expect(() => changeItinerary(before, move, valid)).toThrow("来源");
  });
  it("never treats an unchanged unknown edge as a known or free route", () => {
    const before = fixtureItinerary();
    before.days[0].schedule!.legs[2].route = null;
    const after = changeItinerary(before, move, results(before));
    expect(after.days[0].schedule!.legs[1].route).toBeNull();
    expect(after.days[0].schedule!.items[2].startMinute).toBeNull();
    expect(after.days[0].schedule!.items[3].startMinute).toBeNull();
  });
  it("blocks displacement of another position lock and cross-day movement of fixed times or recorded reservations", () => {
    const locked = changeItinerary(fixtureItinerary(), {
      kind: "position_lock",
      activityId: "activity:trip-0-2",
      locked: true,
    });
    expect(() => changeItinerary(locked, move)).toThrow("位置锁");
    const timed = changeItinerary(fixtureItinerary(), {
      kind: "time_lock",
      activityId: move.activityId,
      locked: true,
    });
    expect(() => changeItinerary(timed, { ...move, toDay: 1 })).toThrow("对象已变化");
    const reserved = fixtureItinerary();
    reserved.days[0].schedule!.items[1].activity.rules = {
      date: reserved.days[0].date,
      openingWindows: null,
      lastEntryMinute: null,
      reservation: {
        state: "confirmed",
        entryWindow: { startMinute: 600, endMinute: 660 },
      },
      source: { kind: "user", recordedAt: reserved.generatedAt },
    };
    expect(() => changeItinerary(reserved, { ...move, toDay: 1 })).toThrow("对象已变化");
  });
  it("retains time locks and reports known infeasibility instead of silently unlocking after a reorder", () => {
    const before = changeItinerary(fixtureItinerary(), {
      kind: "time_lock",
      activityId: move.activityId,
      locked: true,
    });
    const after = changeItinerary(before, move, results(before));
    expect(after.status).toBe("infeasible");
    expect(after.days[0].schedule!.items[3].activity.fixedStartMinute).toBe(615);
    expect(() => assertItineraryTimeLocks(before, after)).toThrow();
  });
  it("caps geometry by dropping entire excess segments, preserving durations and adding a truthful notice", () => {
    const before = fixtureItinerary();
    const routes = results(before);
    routes[0].route.segments = [
      Array.from({ length: 300 }, () => [120.1, 30.2] as [number, number]),
      Array.from({ length: 300 }, () => [120.2, 30.3] as [number, number]),
    ];
    const after = changeItinerary(before, move, routes);
    const leg = after.days[0].schedule!.legs[0].route!;
    expect(leg.segments).toHaveLength(1);
    expect(leg.segments[0]).toHaveLength(300);
    expect(leg.seconds).toBe(route.seconds);
    expect(leg.meters).toBe(route.meters);
    expect(after.days[0].notices.some((text) => text.includes("未用直线补全"))).toBe(
      true,
    );
    expect(routes[0].route.segments).toHaveLength(2);
  });
});

describe("versioned route resolution", () => {
  it("requires all new edges and recomputes from current operations, not edited preview timings or reports", () => {
    state().receive(fixtureItinerary(), 0);
    const before = state().plan!;
    state().proposeChange(move);
    const id = state().review!.id;
    expect(() => state().confirm()).toThrow("先查询");
    const routes = results(before);
    state().resolveMoveRoute(id, 1, routes[0]);
    expect(() => state().confirm()).toThrow("先查询");
    expect(() => state().resolveMoveRoute(id, 1, routes[0])).toThrow("不一致");
    expect(state().review!.routes).toHaveLength(1);
    for (const result of routes.slice(1)) {
      state().resolveMoveRoute(id, 1, result);
    }
    state().review!.plan.days[0].schedule!.items.reverse();
    state().review!.plan.status = "unverified";
    state().confirm();
    expect(state().plan!.days[0].schedule!.items[3].activity.id).toBe(move.activityId);
    expect(state().plan!.days[0].schedule!.items[3].startMinute).toBe(825);
    expect(state().version).toBe(2);
    state().undo();
    expect(state().plan).toBe(before);
    expect(state().version).toBe(3);
  });
  it("ignores cancelled or stale responses even when the same operation is reopened at the same base version", () => {
    state().receive(fixtureItinerary(), 0);
    const result = results(state().plan!)[0];
    state().proposeChange(move);
    const old = state().review!.id;
    state().cancelReview();
    state().proposeChange(move);
    const next = state().review!.id;
    expect(next).toBeGreaterThan(old);
    expect(() => state().resolveMoveRoute(old, 1, result)).toThrow("预览已关闭");
    expect(state().review!.routes).toHaveLength(0);
    state().resolveMoveRoute(next, 1, result);
    expect(state().review!.routes).toHaveLength(1);
    useItineraryStore.setState({ version: 2 });
    expect(() => state().resolveMoveRoute(next, 1, results()[1])).toThrow("行程已变化");
    expect(state().plan!.days[0].schedule!.items[1].activity.id).toBe(move.activityId);
  });
});
