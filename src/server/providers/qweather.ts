import { z } from "zod";
import type { Coordinate } from "@/domain/models";
import {
  roundWeatherLocation,
  type DailyWeather,
  type WeatherSource,
} from "@/domain/weather";
import { dailyWeatherSchema, weatherSourceSchema } from "@/lib/weather-contracts";
import { withProviderBudget } from "./budget";
import { ProviderError } from "./errors";

const time = z.iso.datetime({ offset: true });
const temperature = z.object({ value: z.number(), unit: z.literal("°C") }).nullish();
const period = z
  .object({
    forecastStartTime: time,
    forecastEndTime: time,
    condition: z.object({ text: z.string().min(1).max(160).nullish() }).nullish(),
    precipitation: z
      .object({
        amount: z
          .object({ value: z.number().nonnegative(), unit: z.literal("mm") })
          .nullish(),
        probability: z.number().min(0).max(1).nullish(),
        type: z.enum(["rain", "snow", "ice", "mixed", "none", "unknown"]).nullish(),
      })
      .nullish(),
  })
  .nullish();
const responseSchema = z
  .object({
    metadata: z.object({
      attributions: z.array(z.string().min(1).max(2048)).min(1).max(10),
      zeroResult: z.boolean().optional(),
    }),
    days: z
      .array(
        z.object({
          forecastStartTime: time,
          forecastEndTime: time,
          temperatureMin: temperature,
          temperatureMax: temperature,
          daytime: period,
          nighttime: period,
        }),
      )
      .max(10)
      .optional(),
  })
  .refine((value) =>
    value.metadata.zeroResult ? !value.days?.length : Boolean(value.days),
  );

export type WeatherConfig = {
  origin: string;
  authentication: { type: "jwt" | "key"; value: string };
};

export function weatherConfig(
  env: Record<string, string | undefined> = process.env,
): WeatherConfig {
  const host = env.QWEATHER_API_HOST?.trim();
  const jwt = env.QWEATHER_JWT?.trim();
  const key = env.QWEATHER_API_KEY?.trim();
  if (!host || (!jwt && !key)) {
    throw new ProviderError(
      "not_configured",
      "天气暂不可用，当前天气保持未知。",
      "weather_not_configured",
    );
  }
  try {
    const url = new URL(host.startsWith("https://") ? host : `https://${host}`);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/" ||
      url.port ||
      !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.qweatherapi\.com$/i.test(url.hostname) ||
      (jwt && key) ||
      (jwt && !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(jwt)) ||
      (key && !/^[A-Za-z0-9_-]{1,256}$/.test(key))
    ) {
      throw new Error("invalid configuration");
    }
    return {
      origin: url.origin,
      authentication: jwt ? { type: "jwt", value: jwt } : { type: "key", value: key! },
    };
  } catch {
    throw new ProviderError(
      "not_configured",
      "天气暂不可用，当前天气保持未知。",
      "weather_invalid_config",
    );
  }
}

export class QWeatherProvider {
  private readonly config: WeatherConfig;
  constructor(
    config: WeatherConfig,
    private readonly transport: typeof fetch = fetch,
  ) {
    this.config = weatherConfig({
      QWEATHER_API_HOST: config.origin,
      QWEATHER_JWT:
        config.authentication.type === "jwt" ? config.authentication.value : undefined,
      QWEATHER_API_KEY:
        config.authentication.type === "key" ? config.authentication.value : undefined,
    });
  }
  async daily(
    location: Coordinate,
    days: number,
    signal?: AbortSignal,
  ): Promise<{ days: DailyWeather[]; source: WeatherSource }> {
    // This branch supports the first-edition mainland GCJ-02 convention only.
    // Bounds are a coarse exclusion, not a country-border classifier.
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > 10 ||
      !Number.isFinite(location[0]) ||
      !Number.isFinite(location[1]) ||
      location[0] < 72 ||
      location[0] > 138 ||
      location[1] < 0.8 ||
      location[1] > 56
    ) {
      throw new ProviderError(
        "unavailable",
        "当前位置或日期范围不能用于此天气查询。",
        "weather_unsupported_location",
      );
    }
    const rounded = roundWeatherLocation(location);
    const url = new URL(
      `/weather/v1/daily/${rounded[1]}/${rounded[0]}`,
      this.config.origin,
    );
    url.search = new URLSearchParams({
      days: String(days),
      localTime: "true",
      lang: "zh",
    }).toString();
    const { authentication } = this.config;
    const headers: Record<string, string> =
      authentication.type === "jwt"
        ? { Authorization: `Bearer ${authentication.value}` }
        : { "X-QW-Api-Key": authentication.value };
    return withProviderBudget(async () => {
      try {
        const timeout = AbortSignal.timeout(8000);
        const response = await this.transport(url, {
          headers,
          cache: "no-store",
          redirect: "error",
          signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
        });
        if (!response.ok) {
          throw new ProviderError(
            response.status === 401 || response.status === 403
              ? "permission_denied"
              : "unavailable",
            "天气查询未成功，当前天气保持未知。",
            response.status === 429 ? "weather_rate_limited" : "weather_upstream_http",
          );
        }
        const text = await response.text();
        if (text.length > 500_000) {
          throw new Error("response limit");
        }
        const raw: unknown = JSON.parse(text);
        if (typeof raw !== "object" || raw === null || "error" in raw) {
          throw new Error("business error");
        }
        const parsed = responseSchema.parse(raw);
        const normalized = (parsed.days ?? [])
          .map((day) => {
            const normalizePeriod = (value: z.infer<typeof period>) =>
              value
                ? {
                    startsAt: new Date(value.forecastStartTime).toISOString(),
                    endsAt: new Date(value.forecastEndTime).toISOString(),
                    description: value.condition?.text ?? null,
                    precipitationType: value.precipitation?.type ?? null,
                    probability: value.precipitation?.probability ?? null,
                    amountMm: value.precipitation?.amount?.value ?? null,
                  }
                : null;
            return dailyWeatherSchema.parse({
              startsAt: new Date(day.forecastStartTime).toISOString(),
              endsAt: new Date(day.forecastEndTime).toISOString(),
              minC: day.temperatureMin?.value ?? null,
              maxC: day.temperatureMax?.value ?? null,
              daytime: normalizePeriod(day.daytime),
              nighttime: normalizePeriod(day.nighttime),
            });
          })
          .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
        for (let index = 1; index < normalized.length; index += 1) {
          if (
            Date.parse(normalized[index].startsAt) <
            Date.parse(normalized[index - 1].endsAt)
          ) {
            throw new Error("overlapping forecast");
          }
        }
        const source = weatherSourceSchema.parse({
          kind: "provider",
          provider: "qweather",
          queriedAt: new Date().toISOString(),
          updatedAt: null,
          coordinateSystem: "GCJ-02",
          location: rounded,
          granularity: "daily",
          attributions: parsed.metadata.attributions,
        });
        const publicJson = JSON.stringify({ days: normalized, source });
        if (
          [authentication.value, new URL(this.config.origin).hostname].some((secret) =>
            publicJson.includes(secret),
          )
        ) {
          throw new Error("credential echo");
        }
        return { days: normalized, source };
      } catch (error) {
        if (error instanceof ProviderError) {
          throw error;
        }
        throw new ProviderError(
          "unavailable",
          "天气查询超时、网络异常或数据格式错误；当前天气保持未知。",
          "weather_invalid_response",
        );
      }
    });
  }
}
