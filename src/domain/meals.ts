import type { Coordinate, Draft, Stop } from "./models";
import type { StopLock } from "./editing";
import { makeDay, makeDraft } from "./draft";
import type { Route } from "./models";
import {
  scheduleMealDay,
  scheduleVisitDay,
  type ActivityLeg,
  type DayActivity,
  type MealDayPlan,
  type MinuteWindow,
} from "./meal-planning";

export type MealEntry = DayActivity & {
  kind: "lunch" | "dinner";
  window: MinuteWindow;
  meal: NonNullable<DayActivity["meal"]>;
  afterPlaceId: string | null;
};
export type MealConnection = ActivityLeg & {
  origin: Coordinate;
  destination: Coordinate;
};
export type MealSetup = {
  days: { date: string; endMinute: number; entries: MealEntry[] }[];
  connections: MealConnection[];
};
export type MealRouteGap = {
  fromId: string;
  toId: string;
  origin: Coordinate;
  destination: Coordinate;
};
export type MealTripView = {
  draft: Draft;
  plans: MealDayPlan[];
  gaps: MealRouteGap[];
  conflicts: string[];
};
export const stopIdentity = (item: Stop) => item.activityId ?? item.place.id;

export function emptyMeals(): MealSetup {
  return { days: [], connections: [] };
}

// Stable, injective IDs keep visit instances separate from POI IDs and meal instances.
export function visitActivityId(placeId: string): string {
  return `activity:visit-${Array.from(new TextEncoder().encode(placeId), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
const samePoint = (left: Coordinate, right: Coordinate) =>
  left.every((value, index) => value === right[index]);

export const deferredVisitRoute = "该景点邻段尚未单独查询。";

export function mergeMealConnections(
  setup: MealSetup,
  gaps: MealRouteGap[],
  routes: Route[],
): MealSetup {
  if (gaps.length !== routes.length) {
    throw new Error("路线结果与受影响路段不一致，未应用修改。");
  }
  const next = structuredClone(setup);
  for (const [index, gap] of gaps.entries()) {
    next.connections = next.connections.filter(
      (connection) =>
        connection.fromActivityId !== gap.fromId || connection.toActivityId !== gap.toId,
    );
    next.connections.push({
      fromActivityId: gap.fromId,
      toActivityId: gap.toId,
      origin: [...gap.origin],
      destination: [...gap.destination],
      route: structuredClone(routes[index]),
    });
  }
  return next;
}

// Promote queried visit-only edges into the canonical visit skeleton, never its meal projection.
export function applyVisitConnections(
  draft: Draft,
  locks: Record<string, StopLock>,
  connections: MealConnection[],
): Draft {
  let changed = false;
  const days = draft.days.map((day) => {
    let updated = false;
    const legs = day.legs.map((leg, index) => {
      const from = day.items[index].place;
      const to = day.items[index + 1].place;
      const connection = connections.find(
        (item) =>
          item.fromActivityId === visitActivityId(from.id) &&
          item.toActivityId === visitActivityId(to.id) &&
          samePoint(item.origin, from.location) &&
          samePoint(item.destination, to.location),
      );
      if (!connection?.route) {
        return leg;
      }
      updated = true;
      return { ...leg, route: structuredClone(connection.route), error: null };
    });
    if (!updated) {
      return day;
    }
    changed = true;
    const timing = Object.fromEntries(
      day.items.map((item) => [
        item.place.id,
        {
          stayMinutes: item.stayMinutes,
          fixedStartMinute: locks[item.place.id]?.time?.minute,
          venueRules: item.venueRules,
        },
      ]),
    );
    return makeDay(
      day.date,
      day.items.map((item) => item.place),
      legs,
      draft.input.stayMinutes,
      draft.input.bufferMinutes,
      timing,
    );
  });
  return changed ? makeDraft(draft.input, days, draft.notices) : draft;
}

export function activeMealConnections(setup: MealSetup, view: Draft): MealSetup {
  const active = new Set<string>();
  for (const day of view.days) {
    for (const [index, to] of day.items.entries()) {
      if (index === 0) {
        continue;
      }
      const from = day.items[index - 1];
      if ((from.purpose ?? "visit") !== "visit" || (to.purpose ?? "visit") !== "visit") {
        active.add(JSON.stringify([from.activityId, to.activityId]));
      }
    }
  }
  return {
    days: setup.days,
    connections: setup.connections.filter((leg) =>
      active.has(JSON.stringify([leg.fromActivityId, leg.toActivityId])),
    ),
  };
}

// Only choices and queried connections are stored; this projection is never a second editor state.
export function deriveMealTrip(
  draft: Draft,
  locks: Record<string, StopLock>,
  setup: MealSetup,
  enforceUnknownLocks = true,
): MealTripView {
  draft = applyVisitConnections(draft, locks, setup.connections);
  const hasDeferred = draft.days.some((day) =>
    day.legs.some((leg) => leg.route === null && leg.error === deferredVisitRoute),
  );
  const hasVisitRules = draft.days.some((day) =>
    day.items.some((item) => item.venueRules != null),
  );
  if (
    setup.days.length === 0 &&
    !hasDeferred &&
    !hasVisitRules &&
    Object.keys(locks).length === 0
  ) {
    return { draft, plans: [], gaps: [], conflicts: [] };
  }
  const result = structuredClone(draft);
  const plans: MealDayPlan[] = [];
  const gaps: MealRouteGap[] = [];
  const conflicts: string[] = [];
  const settings = [
    ...setup.days,
    ...draft.days
      .filter(
        (day) =>
          !setup.days.some((setting) => setting.date === day.date) &&
          day.items.some((item) => item.venueRules != null),
      )
      .map((day) => ({ date: day.date, endMinute: 1080, entries: [] })),
  ];
  for (const setting of settings) {
    const hasMeals = setup.days.some((day) => day.date === setting.date);
    const dayIndex = draft.days.findIndex((day) => day.date === setting.date);
    if (dayIndex === -1) {
      conflicts.push("用餐日期已不在当前行程中，请重新安排，不会自动删除餐次。");
      continue;
    }
    const day = draft.days[dayIndex];
    const activities: DayActivity[] = [];
    const append = (anchor: string | null) => {
      for (const entry of setting.entries.filter(
        (item) => item.afterPlaceId === anchor,
      )) {
        const { afterPlaceId, ...activity } = structuredClone(entry);
        void afterPlaceId;
        activities.push(activity);
      }
    };
    append(null);
    for (const item of day.items) {
      activities.push({
        id: visitActivityId(item.place.id),
        kind: "visit",
        place: item.place,
        stayMinutes: item.stayMinutes,
        window: null,
        fixedStartMinute: locks[item.place.id]?.time?.minute ?? null,
        rules: item.venueRules ?? null,
        meal: null,
      });
      append(item.place.id);
    }
    const orphaned = setting.entries.filter(
      (entry) =>
        entry.afterPlaceId !== null &&
        !day.items.some((item) => item.place.id === entry.afterPlaceId),
    );
    if (orphaned.length) {
      conflicts.push(
        "用餐插入位置的景点已跨天或移除，请重新预览餐次位置，不会自动删除餐次。",
      );
      for (const entry of orphaned) {
        const { afterPlaceId, ...activity } = structuredClone(entry);
        void afterPlaceId;
        activities.push(activity);
      }
    }
    const legs: ActivityLeg[] = activities.slice(1).map((to, index) => {
      const from = activities[index];
      const queried = setup.connections.find(
        (connection) =>
          connection.fromActivityId === from.id &&
          connection.toActivityId === to.id &&
          samePoint(connection.origin, from.place.location) &&
          samePoint(connection.destination, to.place.location),
      );
      const existing =
        from.kind === "visit" && to.kind === "visit"
          ? day.legs.find(
              (leg) => leg.fromId === from.place.id && leg.toId === to.place.id,
            )
          : null;
      const route = queried?.route ?? existing?.route ?? null;
      if (route === null && (hasMeals || existing?.error === deferredVisitRoute)) {
        gaps.push({
          fromId: from.id,
          toId: to.id,
          origin: [...from.place.location],
          destination: [...to.place.location],
        });
      }
      return { fromActivityId: from.id, toActivityId: to.id, route };
    });
    const plan = (hasMeals ? scheduleMealDay : scheduleVisitDay)({
      date: day.date,
      timeZone: "Asia/Shanghai",
      startMinute: 540,
      endMinute: setting.endMinute,
      bufferMinutes: draft.input.bufferMinutes,
      activities,
      legs,
    });
    plans.push(plan);
    conflicts.push(
      ...plan.issues
        .filter((issue) => issue.severity === "conflict")
        .map((issue) => issue.message),
    );
    const items: Stop[] = plan.items.map((item) => ({
      activityId: item.activity.id,
      purpose: item.activity.kind,
      place: item.activity.place,
      startMinute: item.startMinute,
      endMinute: item.endMinute,
      stayMinutes: item.activity.stayMinutes,
      ...(item.activity.kind === "visit" && item.activity.rules !== null
        ? { venueRules: item.activity.rules }
        : {}),
    }));
    result.days[dayIndex] = {
      date: day.date,
      items,
      legs: plan.legs.map((leg, index) => ({
        fromId: items[index].place.id,
        toId: items[index + 1].place.id,
        route: leg.route,
        error: leg.route ? null : "用餐影响的路线待查询",
      })),
      issues: plan.issues.map((issue) => issue.message),
    };
  }
  for (const day of draft.days.filter(
    (item) => !settings.some((setting) => setting.date === item.date),
  )) {
    for (const [index, leg] of day.legs.entries()) {
      if (leg.route === null && leg.error === deferredVisitRoute) {
        const from = day.items[index].place;
        const to = day.items[index + 1].place;
        gaps.push({
          fromId: visitActivityId(from.id),
          toId: visitActivityId(to.id),
          origin: [...from.location],
          destination: [...to.location],
        });
      }
    }
  }
  for (const [id, lock] of Object.entries(locks)) {
    const dayIndex = result.days.findIndex((day) =>
      day.items.some(
        (item) => item.place.id === id && (item.purpose ?? "visit") === "visit",
      ),
    );
    if (dayIndex === -1) {
      conflicts.push("锁定景点已不在行程中，不会忽略原锁。");
      continue;
    }
    const day = result.days[dayIndex];
    const index = day.items.findIndex(
      (item) => item.place.id === id && (item.purpose ?? "visit") === "visit",
    );
    const item = day.items[index];
    if (
      lock.position &&
      (dayIndex !== lock.position.dayIndex || index !== lock.position.index)
    ) {
      conflicts.push(`“${item.place.name}”的完整行程位置已锁定，请先解锁。`);
    }
    if (
      lock.time &&
      (day.date !== lock.time.date ||
        ((enforceUnknownLocks || item.startMinute !== null) &&
          item.startMinute !== lock.time.minute))
    ) {
      conflicts.push(`无法保证“${item.place.name}”的锁定时间，不会自动解除原锁。`);
    }
  }
  const configured = new Set(setup.days.map((day) => day.date));
  const otherInfeasible = result.days.some(
    (day) =>
      !configured.has(day.date) &&
      day.items.some((item) => item.endMinute !== null && item.endMinute > 1080),
  );
  result.status = conflicts.length || otherInfeasible ? "infeasible" : "unverified";
  if (setup.days.length) {
    result.notices[0] =
      "已安排日期的餐次按你选择的地点与时间窗推算；其他日期午晚餐仍待安排。营业、预约、饮食与费用需核实。";
  }
  return { draft: result, plans, gaps, conflicts: [...new Set(conflicts)] };
}
