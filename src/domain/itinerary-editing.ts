import type { Itinerary } from "./itinerary";
import { briefDays } from "./trip-brief";
import { scheduleAvailableDay, type VenueRules } from "./meal-planning";
import { reservationKey, type MealReservationRelease } from "./meal-reservations";
import { budgetCategories } from "./budget";
import {
  emptyItineraryExpenses,
  summarizeItineraryExpenses,
  type ItineraryExpenses,
} from "./itinerary-expenses";
import {
  prepareItineraryMove,
  type ItineraryMove,
  type ItineraryRouteResolution,
} from "./itinerary-moves";

export type ItineraryChange =
  | { kind: "duration"; activityId: string; stayMinutes: number }
  | { kind: "time_lock"; activityId: string; locked: boolean }
  | { kind: "position_lock"; activityId: string; locked: boolean }
  | ItineraryMove
  | { kind: "expenses"; expenses: ItineraryExpenses; acknowledgeOver: boolean }
  | {
      kind: "venue_rules";
      activityId: string;
      rules: VenueRules | null;
      reservationRelease: MealReservationRelease | null;
    };

export function itineraryRuleRelease(
  plan: Itinerary,
  activityId: string,
  rules: VenueRules | null,
): MealReservationRelease | null {
  const matches = plan.days.flatMap((day) =>
    (day.schedule?.items ?? [])
      .filter((item) => item.activity.id === activityId)
      .map((item) => ({ date: day.date, activity: item.activity })),
  );
  if (matches.length !== 1) {
    throw new Error("活动实例不存在或重复，请重新选择。");
  }
  const { date, activity } = matches[0];
  if (activity.rules?.reservation.state !== "confirmed") {
    return null;
  }
  const beforeKey = reservationKey(date, activity);
  const afterKey = reservationKey(date, { ...activity, rules });
  return beforeKey === afterKey ? null : { activityId, beforeKey, afterKey };
}

// Requires validated snapshots. Timings and reports are always derived, never accepted from a preview.
export function rescheduleItinerary(input: Itinerary): Itinerary {
  const plan = structuredClone(input);
  const availability = briefDays(plan.brief);
  plan.days = plan.days.map((day, index) => {
    if (!day.schedule) {
      return day;
    }
    const window = availability[index]?.activityWindow;
    if (!window) {
      throw new Error("当天没有可用时段，不能保留伪造的活动安排。");
    }
    return {
      ...day,
      schedule: scheduleAvailableDay({
        date: day.date,
        timeZone: "Asia/Shanghai",
        startMinute: window.startMinute,
        endMinute: window.endMinute,
        bufferMinutes: 10,
        activities: day.schedule.items.map((item) => item.activity),
        legs: day.schedule.legs,
      }),
    };
  });
  plan.status =
    plan.constraints.some((constraint) => constraint.status === "conflict") ||
    plan.days.some((day) => day.schedule?.status === "infeasible")
      ? "infeasible"
      : "unverified";
  return plan;
}
export function changeItinerary(
  input: Itinerary,
  change: ItineraryChange,
  resolutions: ItineraryRouteResolution[] = [],
): Itinerary {
  const plan = rescheduleItinerary(input);
  if (change.kind === "expenses") {
    if (resolutions.length > 0) {
      throw new Error("费用修改不需要新的路线结果。");
    }
    const summary = summarizeItineraryExpenses(plan.brief, change.expenses);
    if (summary.status === "over" && !change.acknowledgeOver) {
      throw new Error("已知估算已超过预算目标，请明确知情确认；不会自动增加预算。");
    }
    const previous = plan.expenses ?? emptyItineraryExpenses();
    const same = (category: (typeof budgetCategories)[number]) =>
      previous.items[category].amountFen === change.expenses.items[category].amountFen &&
      previous.items[category].basis === change.expenses.items[category].basis;
    if (budgetCategories.every(same)) {
      throw new Error("费用估算没有变化。");
    }
    const expenses = structuredClone(change.expenses);
    for (const category of budgetCategories) {
      if (same(category)) {
        expenses.items[category] = structuredClone(previous.items[category]);
      }
    }
    plan.expenses = expenses;
    return plan;
  }
  if (change.kind === "move") {
    const prepared = prepareItineraryMove(plan, change, resolutions);
    const after = rescheduleItinerary({ ...plan, days: prepared.days });
    assertItineraryTimeLocks(plan, after, undefined, undefined, true);
    return after;
  }
  if (resolutions.length > 0) {
    throw new Error("当前操作不需要新的路线结果。");
  }
  const matches = plan.days.flatMap(
    (day) =>
      day.schedule?.items.filter((item) => item.activity.id === change.activityId) ?? [],
  );
  if (matches.length !== 1) {
    throw new Error("活动实例不存在或重复，请重新选择。");
  }
  const item = matches[0];
  if (change.kind === "venue_rules") {
    const required = itineraryRuleRelease(plan, change.activityId, change.rules);
    const release = change.reservationRelease;
    if (
      release &&
      (!required ||
        Object.keys(release).length !== 3 ||
        release.activityId !== required.activityId ||
        release.beforeKey !== required.beforeKey ||
        release.afterKey !== required.afterKey)
    ) {
      throw new Error("预约变更核对与当前修改不一致，请重新预览并明确核对。");
    }
    if (required && !release) {
      throw new Error("原预约为强约束，变更或移除须先明确核对，不会代为取消商家预约。");
    }
    const facts = (rules: VenueRules | null) =>
      rules === null ? null : JSON.stringify({ ...rules, source: null });
    if (facts(item.activity.rules) === facts(change.rules)) {
      throw new Error("营业／预约记录没有变化。");
    }
    item.activity.rules = structuredClone(change.rules);
  } else if (change.kind === "position_lock") {
    if (Boolean(item.activity.positionLocked) === change.locked) {
      throw new Error("位置锁状态没有变化。");
    }
    item.activity.positionLocked = change.locked;
  } else if (change.kind === "duration") {
    if (
      !Number.isInteger(change.stayMinutes) ||
      change.stayMinutes < 15 ||
      change.stayMinutes > 240
    ) {
      throw new Error("建议停留须为 15—240 分钟的整数。");
    }
    if (item.activity.stayMinutes === change.stayMinutes) {
      throw new Error("停留时间没有变化。");
    }
    item.activity.stayMinutes = change.stayMinutes;
  } else if (change.locked) {
    if (item.activity.fixedStartMinute !== null) {
      throw new Error("这个活动已经有时间锁。");
    }
    if (item.startMinute === null) {
      throw new Error("开始时间待校验，不能锁定未知时间。");
    }
    item.activity.fixedStartMinute = item.startMinute;
  } else {
    if (item.activity.fixedStartMinute === null) {
      throw new Error("这个活动没有时间锁。");
    }
    item.activity.fixedStartMinute = null;
  }
  return rescheduleItinerary(plan);
}
export function assertItineraryTimeLocks(
  before: Itinerary,
  after: Itinerary,
  releasedActivityId?: string,
  releasedPositionId?: string,
  previewTimings = false,
  acknowledgedReservationId?: string,
): void {
  for (const day of before.days) {
    for (const [index, item] of (day.schedule?.items ?? []).entries()) {
      const minute = item.activity.fixedStartMinute;
      const reserved = item.activity.rules?.reservation.state === "confirmed";
      if (minute === null && !reserved && !item.activity.positionLocked) {
        continue;
      }
      const nextDay = after.days.find((candidate) => candidate.date === day.date);
      const nextIndex =
        nextDay?.schedule?.items.findIndex(
          (candidate) => candidate.activity.id === item.activity.id,
        ) ?? -1;
      const next = nextDay?.schedule?.items[nextIndex];
      if (
        !next ||
        next.activity.kind !== item.activity.kind ||
        next.activity.place.id !== item.activity.place.id ||
        next.activity.place.location.some(
          (value, index) => value !== item.activity.place.location[index],
        )
      ) {
        throw new Error("时间锁、位置锁或已记录预约的活动对象已变化，不能自动覆盖。");
      }
      if (
        item.activity.positionLocked &&
        item.activity.id !== releasedPositionId &&
        (nextIndex !== index || next.activity.positionLocked !== true)
      ) {
        throw new Error(
          "当前方案含位置锁，不能用新方案自动解除、替换地点或改变日期与次序；请先明确解除对应位置锁。",
        );
      }
      if (
        reserved &&
        item.activity.id !== acknowledgedReservationId &&
        reservationKey(day.date, { ...next.activity, fixedStartMinute: minute }) !==
          reservationKey(day.date, item.activity)
      ) {
        throw new Error("新方案不能自动变更或移除已记录预约，请先逐项明确核对。");
      }
      if (minute === null || item.activity.id === releasedActivityId) {
        continue;
      }
      if (
        next.activity.fixedStartMinute !== minute ||
        (!previewTimings && next.startMinute !== minute)
      ) {
        throw new Error(
          "当前方案含时间锁，不能用新方案自动解除或覆盖；请先明确解除对应时间锁。",
        );
      }
    }
  }
}
