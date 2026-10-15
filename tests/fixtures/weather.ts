// Authored offline fixture, never a production fallback or real forecast evidence.
import { addDays } from "../../src/domain/draft";
import type { WeatherReport } from "../../src/domain/weather";

export function fixtureWeather(date = "2026-10-17"): WeatherReport {
  const next = addDays(date, 1);
  return {
    date,
    status: "available",
    reason: null,
    day: {
      startsAt: `${date}T00:00:00+08:00`,
      endsAt: `${next}T00:00:00+08:00`,
      minC: 0,
      maxC: 20,
      daytime: {
        startsAt: `${date}T07:00:00+08:00`,
        endsAt: `${date}T19:00:00+08:00`,
        description: "测试降雨",
        precipitationType: "rain",
        probability: 0.6,
        amountMm: 1,
      },
      nighttime: null,
    },
    source: {
      kind: "fixture",
      provider: "qweather",
      queriedAt: "2026-10-14T01:00:00Z",
      updatedAt: null,
      coordinateSystem: "GCJ-02",
      location: [120.1, 30.2],
      granularity: "daily",
      attributions: ["测试署名：仅用于离线交互，不代表平台许可。"],
    },
  };
}
