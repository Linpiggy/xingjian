import type { Coordinate } from "./models";

export type WeatherPeriod = {
  startsAt: string;
  endsAt: string;
  description: string | null;
  precipitationType: "rain" | "snow" | "ice" | "mixed" | "none" | "unknown" | null;
  probability: number | null;
  amountMm: number | null;
};
export type DailyWeather = {
  startsAt: string;
  endsAt: string;
  minC: number | null;
  maxC: number | null;
  daytime: WeatherPeriod | null;
  nighttime: WeatherPeriod | null;
};
export type WeatherSource = {
  kind: "provider" | "fixture";
  provider: "qweather";
  queriedAt: string;
  updatedAt: null;
  coordinateSystem: "GCJ-02";
  location: Coordinate;
  granularity: "daily";
  attributions: string[];
};
export type WeatherReport = {
  date: string;
  status: "available" | "unknown";
  reason: "out_of_range" | "missing_date" | "partial_coverage" | null;
  day: DailyWeather | null;
  source: WeatherSource | null;
};

// Daily v1 accepts at most two decimal places; this is not a datum conversion.
export function roundWeatherLocation(location: Coordinate): Coordinate {
  return [Math.round(location[0] * 100) / 100, Math.round(location[1] * 100) / 100];
}

function midnightUtc(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error("天气查询日期无效。");
  }
  const epoch = Date.parse(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString().slice(0, 10) !== date) {
    throw new Error("天气查询日期无效。");
  }
  return epoch;
}

// This is the documented upper bound, not a guarantee of account coverage.
export function forecastDays(date: string, today: string): number | null {
  const offset = (midnightUtc(date) - midnightUtc(today)) / 86_400_000;
  return offset < 0 || offset > 9 ? null : offset + 1;
}

export function dailyForDate(
  date: string,
  days: DailyWeather[],
  source: WeatherSource,
): WeatherReport {
  const start = midnightUtc(date) - 8 * 3_600_000;
  const end = start + 86_400_000;
  const day =
    days.find(
      (item) => Date.parse(item.startsAt) < end && Date.parse(item.endsAt) > start,
    ) ?? null;
  if (!day) {
    return { date, status: "unknown", reason: "missing_date", day: null, source };
  }
  const complete = Date.parse(day.startsAt) <= start && Date.parse(day.endsAt) >= end;
  return {
    date,
    status: complete ? "available" : "unknown",
    reason: complete ? null : "partial_coverage",
    day,
    source,
  };
}

export function hasPrecipitationSignal(period: WeatherPeriod | null): boolean {
  return Boolean(
    period &&
    ((period.precipitationType !== null &&
      !["none", "unknown"].includes(period.precipitationType)) ||
      (period.probability !== null && period.probability > 0) ||
      (period.amountMm !== null && period.amountMm > 0)),
  );
}
