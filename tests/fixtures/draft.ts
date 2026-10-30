// Authored fixtures only. Never used as a production fallback.
import type { Draft, Place, Source, TripInput, Route } from "../../src/domain/models";
import { addDays, groupPlaces, makeDay, makeDraft } from "../../src/domain/draft";

export const source: Source = {
  kind: "fixture",
  provider: "amap",
  queriedAt: "2026-10-13T00:00:00Z",
  coordinateSystem: "GCJ-02",
};
export const input: TripInput = {
  city: "测试城市",
  startDate: "2026-10-17",
  dayCount: 2,
  travelers: 2,
  budgetPerPersonFen: 150000,
  keywords: ["测试景点一", "测试景点二", "测试景点三", "测试景点四"],
  stayMinutes: 90,
  bufferMinutes: 15,
};
export const places: Place[] = input.keywords.map((name, i) => ({
  id: `fixture-${i}`,
  name,
  address: `测试地址${i}`,
  citycode: "0571",
  location: [120.1 + i * 0.01, 30.2],
  openingHours: null,
  source,
}));
export const route: Route = {
  mode: "walking",
  detail: null,
  meters: 1200,
  seconds: 1200,
  segments: [
    [
      [120.1, 30.2],
      [120.11, 30.2],
    ],
  ],
  source,
};
export function fixtureDraft(): Draft {
  const days = groupPlaces(places, 2).map((group, i) =>
    makeDay(
      addDays(input.startDate, i),
      group,
      [{ fromId: group[0].id, toId: group[1].id, route, error: null }],
      input.stayMinutes,
      input.bufferMinutes,
    ),
  );
  return makeDraft(input, days, [
    "测试 fixture：未安排餐饮，开放、预约与费用待核实。",
    "按输入顺序分天；停留与缓冲来自用户设置。",
  ]);
}
