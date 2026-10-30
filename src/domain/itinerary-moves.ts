import type { Itinerary } from "./itinerary";
import type { Coordinate, Route } from "./models";
import type { DayActivity } from "./meal-planning";
import { briefDays } from "./trip-brief";

export type ItineraryMove = {
  kind: "move";
  activityId: string;
  toDay: number;
  toIndex: number;
};
export type ItineraryRouteGap = {
  fromActivityId: string;
  toActivityId: string;
  origin: Coordinate;
  destination: Coordinate;
};
export type ItineraryRouteResolution = ItineraryRouteGap & { route: Route };
export const itineraryEdgeKey = (gap: ItineraryRouteGap): string =>
  JSON.stringify([gap.fromActivityId, gap.toActivityId, gap.origin, gap.destination]);
function edge(from: DayActivity, to: DayActivity): ItineraryRouteGap {
  return {
    fromActivityId: from.id,
    toActivityId: to.id,
    origin: [...from.place.location],
    destination: [...to.place.location],
  };
}
function notice(day: Itinerary["days"][number], text: string): void {
  if (!day.notices.includes(text)) {
    if (day.notices.length >= 15) {
      throw new Error("当天说明已达上限，当前方案保持不变。");
    }
    day.notices.push(text);
  }
}
// Ordered, intermediate days only. Call the scheduler before displaying or committing them.
// toIndex is the insertion index AFTER removing the target, including meals in the order.
export function prepareItineraryMove(
  input: Itinerary,
  change: ItineraryMove,
  resolutions: ItineraryRouteResolution[] = [],
) {
  const days = structuredClone(input.days);
  const matches = days.flatMap((day, dayIndex) =>
    (day.schedule?.items ?? []).flatMap((item, index) =>
      item.activity.id === change.activityId ? [{ dayIndex, index, item }] : [],
    ),
  );
  if (matches.length !== 1) {
    throw new Error("活动实例不存在或重复，请重新选择。");
  }
  const from = matches[0];
  if (from.item.activity.kind !== "visit") {
    throw new Error("此处仅移动游览活动，餐次保留其用餐窗口。");
  }
  if (
    !Number.isInteger(change.toDay) ||
    change.toDay < 0 ||
    change.toDay >= days.length
  ) {
    throw new Error("目标日期不属于当前行程。");
  }
  const target = days[change.toDay];
  const window = briefDays(input.brief)[change.toDay]?.activityWindow;
  if (!window || !target.schedule) {
    throw new Error("目标日期没有可用活动时段。");
  }
  const length = target.schedule.items.length - (from.dayIndex === change.toDay ? 1 : 0);
  if (
    !Number.isInteger(change.toIndex) ||
    change.toIndex < 0 ||
    change.toIndex > length
  ) {
    throw new Error("目标次序无效，请重新选择。");
  }
  if (from.dayIndex === change.toDay && from.index === change.toIndex) {
    throw new Error("活动位置没有变化。");
  }
  if (length >= 8) {
    throw new Error("当天活动已达八项，请选择其他日期。");
  }
  days[from.dayIndex].schedule!.items.splice(from.index, 1);
  target.schedule.items.splice(change.toIndex, 0, from.item);
  if (from.dayIndex !== change.toDay) {
    from.item.activity.window = { ...window };
    const explanation = days[from.dayIndex].recommendations.find(
      (entry) => entry.activityId === change.activityId,
    );
    days[from.dayIndex].recommendations = days[from.dayIndex].recommendations.filter(
      (entry) => entry.activityId !== change.activityId,
    );
    if (explanation) {
      target.recommendations.push(explanation);
    }
  }
  const original = new Map<string, Route | null>();
  for (const day of input.days) {
    for (const [index, leg] of (day.schedule?.legs ?? []).entries()) {
      original.set(
        itineraryEdgeKey(
          edge(
            day.schedule!.items[index].activity,
            day.schedule!.items[index + 1].activity,
          ),
        ),
        leg.route,
      );
    }
  }
  const gaps: ItineraryRouteGap[] = [];
  for (const index of new Set([from.dayIndex, change.toDay])) {
    const day = days[index];
    const items = day.schedule!.items;
    day.schedule!.legs = items.slice(1).map((item, index) => {
      const gap = edge(items[index].activity, item.activity);
      const key = itineraryEdgeKey(gap);
      if (!original.has(key)) {
        gaps.push(gap);
      }
      return {
        fromActivityId: gap.fromActivityId,
        toActivityId: gap.toActivityId,
        route: structuredClone(original.get(key) ?? null),
      };
    });
    notice(day, "活动已按你指定的顺序调整；原主题与推荐理由不代表本次路线已优化。");
  }
  const supplied = new Map<string, Route>();
  for (const result of resolutions) {
    const key = itineraryEdgeKey(result);
    if (!gaps.some((gap) => itineraryEdgeKey(gap) === key) || supplied.has(key)) {
      throw new Error("路线结果与受影响路段不一致，未应用修改。");
    }
    if (
      result.route.source.kind === "user" ||
      (!input.fixture && result.route.source.kind === "fixture")
    ) {
      throw new Error("路线来源不能冒充真实查询，未应用修改。");
    }
    supplied.set(key, result.route);
  }
  for (const dayIndex of new Set([from.dayIndex, change.toDay])) {
    const day = days[dayIndex];
    for (const [index, leg] of day.schedule!.legs.entries()) {
      const gap = edge(
        day.schedule!.items[index].activity,
        day.schedule!.items[index + 1].activity,
      );
      const result = supplied.get(itineraryEdgeKey(gap));
      if (!result) {
        continue;
      }
      let points = 0;
      const segments = result.segments.filter((segment) => {
        points += segment.length;
        return points <= 500;
      });
      if (segments.length !== result.segments.length) {
        notice(day, "地图仅显示部分原始线路点，未用直线补全；路线耗时与距离保持查询值。");
      }
      leg.route = structuredClone({ ...result, segments });
    }
  }
  return {
    days,
    gaps,
    missing: gaps.filter((gap) => !supplied.has(itineraryEdgeKey(gap))),
  };
}
