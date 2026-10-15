import { describe, expect, it, vi } from "vitest";
import { forecastDays, dailyForDate, hasPrecipitationSignal } from "@/domain/weather";
import { weatherInputSchema, weatherReportSchema } from "@/lib/weather-contracts";
import { QWeatherProvider, weatherConfig } from "@/server/providers/qweather";
import { getWeather } from "@/server/services/get-weather";
import { fixtureWeather } from "../fixtures/weather";

const location: [number, number] = [120.143778, 30.251243];
const config = weatherConfig({
  QWEATHER_API_HOST: "offline-test.qweatherapi.com",
  QWEATHER_API_KEY: "unit_weather_key",
});
function fixtureParts() {
  const report = fixtureWeather();
  if (!report.day || !report.source) {
    throw new Error("Incomplete authored fixture");
  }
  return { day: report.day, source: report.source };
}
function rawFixture() {
  // Authored v1-contract example; not a captured supplier response.
  return {
    metadata: { attributions: ["Offline test attribution"], zeroResult: false },
    days: [
      {
        forecastStartTime: "2026-10-17T00:00:00+08:00",
        forecastEndTime: "2026-10-18T00:00:00+08:00",
        temperatureMin: { value: 0, unit: "°C" },
        temperatureMax: { value: 20, unit: "°C" },
        daytime: {
          forecastStartTime: "2026-10-17T07:00:00+08:00",
          forecastEndTime: "2026-10-17T19:00:00+08:00",
          condition: { text: "Offline test rain" },
          precipitation: {
            probability: 0.6,
            type: "rain",
            amount: { value: 1, unit: "mm" },
          },
        },
      },
    ],
  };
}

describe("daily weather domain and strict DTO", () => {
  it("enforces 1–10 days, date validity and year boundaries without guessing distant weather", () => {
    expect(forecastDays("2026-10-14", "2026-10-14")).toBe(1);
    expect(forecastDays("2026-10-23", "2026-10-14")).toBe(10);
    expect(forecastDays("2026-10-24", "2026-10-14")).toBeNull();
    expect(forecastDays("2026-10-13", "2026-10-14")).toBeNull();
    expect(forecastDays("2027-01-01", "2026-12-31")).toBe(2);
    expect(() => forecastDays("2026-02-30", "2026-02-28")).toThrow();
    expect(() => forecastDays("2026-2-28", "2026-02-28")).toThrow();
  });
  it("compares Shanghai day boundaries, keeps partial coverage and missing dates unknown", () => {
    const { day, source } = fixtureParts();
    expect(dailyForDate("2026-10-17", [day], source).status).toBe("available");
    expect(dailyForDate("2026-10-18", [day], source)).toMatchObject({
      reason: "missing_date",
      day: null,
    });
    expect(
      dailyForDate(
        "2026-10-17",
        [{ ...day, startsAt: "2026-10-17T07:00:00+08:00" }],
        source,
      ),
    ).toMatchObject({ status: "unknown", reason: "partial_coverage" });
    expect(dailyForDate("2026-10-17", [], source).source).toBe(source);
  });
  it("requires coherent date coverage, reasons, attributions and finite units", () => {
    const report = fixtureWeather();
    const { day, source } = fixtureParts();
    expect(weatherReportSchema.safeParse(report).success).toBe(true);
    for (const invalid of [
      { ...report, date: "2026-10-18" },
      { ...report, status: "unknown", reason: null },
      { ...report, reason: "out_of_range" },
      { ...report, source: null },
      { ...report, source: { ...source, attributions: [] } },
      { ...report, day: { ...day, minC: 30, maxC: 20 } },
      { ...report, day: { ...day, maxC: Infinity } },
      { ...report, day: { ...day, endsAt: day.startsAt } },
      { ...report, ownerId: "must-not-exist" },
    ]) {
      expect(weatherReportSchema.safeParse(invalid).success).toBe(false);
    }
    expect(
      weatherReportSchema.safeParse({
        date: report.date,
        status: "unknown",
        reason: "out_of_range",
        day: null,
        source: null,
      }).success,
    ).toBe(true);
    expect(
      weatherInputSchema.safeParse({
        date: report.date,
        location,
        coordinateSystem: "WGS-84",
        region: "CN-mainland",
      }).success,
    ).toBe(false);
    expect(
      weatherInputSchema.safeParse({
        date: report.date,
        location,
        coordinateSystem: "GCJ-02",
      }).success,
    ).toBe(false);
  });
  it("never treats null precipitation as dry, and only produces a coarse risk signal", () => {
    const { day } = fixtureParts();
    expect(hasPrecipitationSignal(null)).toBe(false);
    expect(hasPrecipitationSignal(day.daytime)).toBe(true);
    const period = day.daytime;
    if (!period) {
      throw new Error("Missing authored period");
    }
    expect(
      hasPrecipitationSignal({
        ...period,
        precipitationType: "unknown",
        probability: null,
        amountMm: null,
      }),
    ).toBe(false);
    expect(
      hasPrecipitationSignal({
        ...period,
        precipitationType: "none",
        probability: 0,
        amountMm: 0,
      }),
    ).toBe(false);
    expect(
      hasPrecipitationSignal({
        ...period,
        precipitationType: "snow",
        probability: null,
        amountMm: null,
      }),
    ).toBe(true);
  });
  it("does not initialize configuration or call a provider for out-of-range dates", async () => {
    const provider = vi.fn(() => {
      throw new Error("must not initialize");
    });
    expect(
      await getWeather("2026-10-24", location, "2026-10-14", provider),
    ).toMatchObject({ reason: "out_of_range", day: null, source: null });
    expect(provider).not.toHaveBeenCalled();
    const { day, source } = fixtureParts();
    const daily = vi.fn(async () => ({
      days: [day],
      source: { ...source, location: [120.14, 30.25] as [number, number] },
    }));
    const signal = new AbortController().signal;
    expect(
      await getWeather("2026-10-17", location, "2026-10-14", () => ({ daily }), signal),
    ).toMatchObject({ status: "available" });
    expect(daily).toHaveBeenCalledExactlyOnceWith(location, 4, signal);
  });
});

describe("weather response consistency regressions", () => {
  it("does not allow missing-date reports to carry a different day's forecast", () => {
    const report = fixtureWeather();
    expect(
      weatherReportSchema.safeParse({
        ...report,
        date: "2026-10-18",
        status: "unknown",
        reason: "missing_date",
      }).success,
    ).toBe(false);
  });
  it("invalid dates return schema issues rather than throwing from a refinement", () => {
    expect(() =>
      weatherReportSchema.safeParse({ ...fixtureWeather(), date: "2026-02-30" }),
    ).not.toThrow();
    expect(
      weatherReportSchema.safeParse({ ...fixtureWeather(), date: "2026-02-30" }).success,
    ).toBe(false);
  });
  it("rejects multi-day daily intervals and periods unrelated to the parent day", () => {
    const report = fixtureWeather();
    const { day } = fixtureParts();
    expect(
      weatherReportSchema.safeParse({
        ...report,
        day: {
          ...day,
          nighttime: {
            ...day.daytime,
            startsAt: "2026-10-17T19:00:00+08:00",
            endsAt: "2026-10-18T07:00:00+08:00",
          },
        },
      }).success,
    ).toBe(true);
    expect(
      weatherReportSchema.safeParse({
        ...report,
        day: { ...day, endsAt: "2026-10-19T00:00:00+08:00" },
      }).success,
    ).toBe(false);
    expect(
      weatherReportSchema.safeParse({
        ...report,
        day: {
          ...day,
          daytime: {
            ...day.daytime,
            startsAt: "2026-10-18T07:00:00+08:00",
            endsAt: "2026-10-18T19:00:00+08:00",
          },
        },
      }).success,
    ).toBe(false);
  });
  it("rejects the wrong reference location even for a complete forecast date", async () => {
    const { day, source } = fixtureParts();
    const daily = vi.fn(async () => ({ days: [day], source }));
    await expect(
      getWeather("2026-10-17", location, "2026-10-14", () => ({ daily })),
    ).rejects.toMatchObject({ code: "weather_location_mismatch" });
  });
});

describe("QWeather v1 adapter (no live network)", () => {
  it("requires explicit private configuration and mutually exclusive credentials", () => {
    for (const env of [
      {},
      { QWEATHER_API_HOST: config.origin },
      { QWEATHER_API_KEY: "unit_weather_key" },
    ]) {
      expect(() => weatherConfig(env)).toThrow(
        expect.objectContaining({ code: "weather_not_configured" }),
      );
    }
    expect(() =>
      weatherConfig({
        QWEATHER_API_HOST: config.origin,
        QWEATHER_API_KEY: "key",
        QWEATHER_JWT: "header.payload.signature",
      }),
    ).toThrow(expect.objectContaining({ code: "weather_invalid_config" }));
  });
  it.each([
    "http://offline-test.qweatherapi.com",
    "https://example.com",
    "https://offline-test.qweatherapi.com/path",
    "https://offline-test.qweatherapi.com?key=bad",
    "https://offline-test.qweatherapi.com#hash",
    "https://user:pass@offline-test.qweatherapi.com",
    "https://offline-test.qweatherapi.com:1234",
    "https://qweatherapi.com.attacker.invalid",
  ])("rejects arbitrary host configuration: %s", (host) => {
    expect(() =>
      weatherConfig({ QWEATHER_API_HOST: host, QWEATHER_API_KEY: "unit_weather_key" }),
    ).toThrow(expect.objectContaining({ code: "weather_invalid_config" }));
  });
  it("uses GCJ-02 latitude-first two-decimal path, one private header, no-store and no redirects", async () => {
    const transport = vi.fn<typeof fetch>(async () => Response.json(rawFixture()));
    const result = await new QWeatherProvider(config, transport).daily(location, 4);
    expect(result.days[0]).toMatchObject({
      startsAt: "2026-10-16T16:00:00.000Z",
      minC: 0,
      maxC: 20,
      nighttime: null,
    });
    expect(result.source).toMatchObject({
      kind: "provider",
      location: [120.14, 30.25],
      updatedAt: null,
      granularity: "daily",
      attributions: ["Offline test attribution"],
    });
    const [url, options] = transport.mock.calls[0];
    expect(String(url)).toBe(
      `${config.origin}/weather/v1/daily/30.25/120.14?days=4&localTime=true&lang=zh`,
    );
    expect(options).toMatchObject({
      headers: { "X-QW-Api-Key": "unit_weather_key" },
      cache: "no-store",
      redirect: "error",
    });
    expect(JSON.stringify(result)).not.toContain("unit_weather_key");
    expect(JSON.stringify(result)).not.toContain("offline-test.qweatherapi.com");
    expect(transport).toHaveBeenCalledTimes(1);
  });
  it("supports bearer JWT without a key, and preserves genuinely absent fields", async () => {
    const raw = rawFixture();
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({
        ...raw,
        days: [
          {
            forecastStartTime: raw.days[0].forecastStartTime,
            forecastEndTime: raw.days[0].forecastEndTime,
          },
        ],
      }),
    );
    const jwtConfig = weatherConfig({
      QWEATHER_API_HOST: config.origin,
      QWEATHER_JWT: "header.payload.signature",
    });
    const result = await new QWeatherProvider(jwtConfig, transport).daily(location, 1);
    expect(transport.mock.calls[0][1]?.headers).toEqual({
      Authorization: "Bearer header.payload.signature",
    });
    expect(result.days[0]).toMatchObject({
      minC: null,
      maxC: null,
      daytime: null,
      nighttime: null,
    });
  });
  it("normalizes an explicit zero-result response without manufacturing a forecast", async () => {
    const transport = vi.fn<typeof fetch>(async () =>
      Response.json({ metadata: { attributions: ["Offline test"], zeroResult: true } }),
    );
    const result = await new QWeatherProvider(config, transport).daily(location, 1);
    expect(result.days).toEqual([]);
    expect(dailyForDate("2026-10-17", result.days, result.source).reason).toBe(
      "missing_date",
    );
  });
  it.each([401, 403, 429, 500])(
    "redacts HTTP %i errors and never retries",
    async (status) => {
      const transport = vi.fn<typeof fetch>(async () =>
        Response.json(
          { error: { detail: "unit_weather_key offline-test.qweatherapi.com" } },
          { status },
        ),
      );
      await expect(
        new QWeatherProvider(config, transport).daily(location, 1),
      ).rejects.toMatchObject({
        code: status === 429 ? "weather_rate_limited" : "weather_upstream_http",
        status: [401, 403].includes(status) ? "permission_denied" : "unavailable",
        message: "天气查询未成功，当前天气保持未知。",
      });
      expect(transport).toHaveBeenCalledTimes(1);
    },
  );
  it("rejects 200 errors, missing attribution, bad units, bad probability, overlaps and credential echoes", async () => {
    const raw = rawFixture();
    const day = raw.days[0];
    const invalidResponses = [
      { ...raw, error: { detail: "private error" } },
      { ...raw, metadata: { attributions: [] } },
      { ...raw, days: [{ ...day, temperatureMin: { value: 0, unit: "F" } }] },
      {
        ...raw,
        days: [
          { ...day, daytime: { ...day.daytime, precipitation: { probability: 60 } } },
        ],
      },
      { ...raw, days: [day, day] },
      { ...raw, days: [{ ...day, forecastEndTime: day.forecastStartTime }] },
      {
        ...raw,
        days: [
          {
            ...day,
            daytime: { ...day.daytime, condition: { text: "unit_weather_key" } },
          },
        ],
      },
      { ...raw, metadata: { attributions: ["offline-test.qweatherapi.com"] } },
      { ...raw, metadata: { ...raw.metadata, zeroResult: true } },
    ];
    for (const body of invalidResponses) {
      const transport = vi.fn<typeof fetch>(async () => Response.json(body));
      await expect(
        new QWeatherProvider(config, transport).daily(location, 1),
      ).rejects.toMatchObject({ code: "weather_invalid_response" });
      expect(transport).toHaveBeenCalledTimes(1);
    }
  });
  it("rejects malformed JSON and an oversized response", async () => {
    for (const text of ["not JSON", " ".repeat(500_001)]) {
      const transport = vi.fn<typeof fetch>(async () => new Response(text));
      await expect(
        new QWeatherProvider(config, transport).daily(location, 1),
      ).rejects.toMatchObject({ code: "weather_invalid_response" });
    }
  });
  it("rejects out-of-range coordinates and days before touching transport", async () => {
    const transport = vi.fn<typeof fetch>();
    const provider = new QWeatherProvider(config, transport);
    await expect(provider.daily([151, -33], 1)).rejects.toMatchObject({
      code: "weather_unsupported_location",
    });
    await expect(provider.daily(location, 11)).rejects.toMatchObject({
      code: "weather_unsupported_location",
    });
    await expect(provider.daily([NaN, 30], 1)).rejects.toMatchObject({
      code: "weather_unsupported_location",
    });
    expect(transport).not.toHaveBeenCalled();
  });
  it("aborts at eight seconds without retrying and propagates caller cancellation safely", async () => {
    vi.useFakeTimers();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation((delay) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), delay);
      return controller.signal;
    });
    try {
      const transport = vi.fn<typeof fetch>(
        async (_url, options) =>
          new Promise<Response>((_resolve, reject) => {
            options?.signal?.addEventListener(
              "abort",
              () => reject(new Error("private transport message")),
              { once: true },
            );
          }),
      );
      const pending = new QWeatherProvider(config, transport).daily(location, 1);
      const rejected = expect(pending).rejects.toMatchObject({
        code: "weather_invalid_response",
      });
      await vi.advanceTimersByTimeAsync(8000);
      await rejected;
      expect(timeout).toHaveBeenCalledExactlyOnceWith(8000);
      expect(transport).toHaveBeenCalledTimes(1);
      const controller = new AbortController();
      const cancelled = new QWeatherProvider(config, transport).daily(
        location,
        1,
        controller.signal,
      );
      const cancellation = expect(cancelled).rejects.toMatchObject({
        code: "weather_invalid_response",
      });
      controller.abort();
      await cancellation;
      expect(transport).toHaveBeenCalledTimes(2);
    } finally {
      timeout.mockRestore();
      vi.useRealTimers();
    }
  });
});
