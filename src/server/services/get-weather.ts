import type { Coordinate } from "@/domain/models";
import {
  dailyForDate,
  forecastDays,
  roundWeatherLocation,
  type DailyWeather,
  type WeatherReport,
  type WeatherSource,
} from "@/domain/weather";

import { ProviderError } from "@/server/providers/errors";

export interface DailyWeatherProvider {
  daily(
    location: Coordinate,
    days: number,
    signal?: AbortSignal,
  ): Promise<{ days: DailyWeather[]; source: WeatherSource }>;
}

export async function getWeather(
  date: string,
  location: Coordinate,
  today: string,
  provider: () => DailyWeatherProvider,
  signal?: AbortSignal,
): Promise<WeatherReport> {
  const days = forecastDays(date, today);
  if (days === null) {
    return { date, status: "unknown", reason: "out_of_range", day: null, source: null };
  }
  const result = await provider().daily(location, days, signal);
  const rounded = roundWeatherLocation(location);
  if (
    result.source.location[0] !== rounded[0] ||
    result.source.location[1] !== rounded[1]
  ) {
    throw new ProviderError(
      "unavailable",
      "天气参考位置与查询不一致，未使用此数据。",
      "weather_location_mismatch",
    );
  }
  return dailyForDate(date, result.days, result.source);
}
