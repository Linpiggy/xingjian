/**
 * 高德 Web 服务适配器（服务端专用，Key 不出服务器）。
 * 只做：地点检索、周边检索、步行/公交/驾车路线、天气预报。
 * 所有响应都用 Zod 宽松解析，缺失字段归一为 null，而不是猜测值。
 */
import { z } from "zod";
import type { Coordinate, Place, Weather } from "@/lib/schema";
import { AppError } from "@/server/errors";

const MIN_INTERVAL_MS = 380;
const RETRY_CODES = new Set(["10004", "10021"]);

let gate: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

/** 个人 Key 并发额度很低，所有请求串行并保持最小间隔 */
function throttle<T>(task: () => Promise<T>): Promise<T> {
  const run = gate.then(async () => {
    const wait = Math.max(0, lastCallAt + MIN_INTERVAL_MS - Date.now());
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    lastCallAt = Date.now();
    return task();
  });
  gate = run.catch(() => undefined);
  return run;
}

const text = z
  .union([z.string(), z.array(z.unknown())])
  .optional()
  .transform((value) =>
    typeof value === "string" && value.trim() ? value.trim() : null,
  );
const numeric = z
  .union([z.string(), z.number(), z.array(z.unknown())])
  .optional()
  .transform((value) => {
    if (value === undefined || Array.isArray(value) || value === "") {
      return null;
    }
    const result = Number(value);
    return Number.isFinite(result) ? result : null;
  });

const poiSchema = z.object({
  id: z.string(),
  name: z.string(),
  location: z.string(),
  address: text,
  type: text,
  typecode: text,
  citycode: text,
  adcode: text,
  business: z
    .object({ rating: numeric, cost: numeric, opentime_week: text, opentime_today: text })
    .partial()
    .optional(),
  photos: z.array(z.object({ url: z.string() }).passthrough()).optional(),
});

export function parseLocation(value: string): Coordinate | null {
  const parts = value.split(",").map(Number);
  if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n))) {
    return null;
  }
  const [lng, lat] = parts;
  if (lng < 73 || lng > 136 || lat < 3 || lat > 54) {
    return null;
  }
  return [lng, lat];
}

function parsePolyline(value: string): Coordinate[] {
  return value
    .split(";")
    .map(parseLocation)
    .filter((point): point is Coordinate => point !== null);
}

/** 高德图片是 http 链接，同一主机支持 https，统一升级避免混合内容 */
function securePhoto(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!/(^|\.)autonavi\.com$|(^|\.)amap\.com$/.test(parsed.hostname)) {
      return null;
    }
    parsed.protocol = "https:";
    return parsed.toString();
  } catch {
    return null;
  }
}

/** 高德 typecode 前两位：05 餐饮、10 住宿、11 风景名胜、14 科教文化、08 体育休闲、06 购物 */
export function categoryOf(typecode: string | null): Place["category"] {
  const prefix = typecode?.slice(0, 2);
  if (prefix === "05") {
    return "food";
  }
  if (prefix === "10") {
    return "hotel";
  }
  if (prefix && ["11", "14", "08", "06", "12", "19"].includes(prefix)) {
    return "sight";
  }
  return "other";
}

function toPlace(raw: z.infer<typeof poiSchema>): Place | null {
  const location = parseLocation(raw.location);
  if (!location) {
    return null;
  }
  return {
    id: raw.id,
    name: raw.name,
    address: raw.address,
    location,
    type: raw.type?.split(";").slice(-1)[0] ?? null,
    rating: raw.business?.rating ?? null,
    avgCost: raw.business?.cost ?? null,
    openTime: raw.business?.opentime_today ?? raw.business?.opentime_week ?? null,
    photos: (raw.photos ?? [])
      .map((photo) => securePhoto(photo.url))
      .filter((url): url is string => url !== null)
      .slice(0, 3),
    citycode: raw.citycode,
    adcode: raw.adcode,
    category: categoryOf(raw.typecode?.split("|")[0] ?? null),
  };
}

export interface RouteResult {
  minutes: number | null;
  meters: number | null;
  costCny: number | null;
  path: Coordinate[];
  summary: string;
}

export class AmapClient {
  constructor(
    private readonly key: string,
    private readonly transport: typeof fetch = fetch,
  ) {}

  private async request(
    path: string,
    params: Record<string, string>,
    retried = false,
  ): Promise<unknown> {
    return throttle(async (): Promise<unknown> => {
      const url = new URL(path, "https://restapi.amap.com");
      url.search = new URLSearchParams({ ...params, key: this.key }).toString();
      let response: Response;
      try {
        response = await this.transport(url, {
          cache: "no-store",
          redirect: "error",
          signal: AbortSignal.timeout(8000),
        });
      } catch {
        throw new AppError("upstream", "高德服务请求超时或网络异常");
      }
      if (!response.ok) {
        throw new AppError("upstream", `高德服务暂不可用（HTTP ${response.status}）`);
      }
      const body = (await response.json()) as { status?: string; infocode?: string };
      if (body.status !== "1") {
        if (!retried && body.infocode && RETRY_CODES.has(body.infocode)) {
          await new Promise((resolve) => setTimeout(resolve, 900));
          return null;
        }
        throw new AppError("upstream", `高德请求未成功（${body.infocode ?? "unknown"}）`);
      }
      return body as unknown;
    }).then((result): Promise<unknown> | unknown =>
      result === null ? this.request(path, params, true) : result,
    );
  }

  async searchText(city: string, keyword: string, limit = 8): Promise<Place[]> {
    const raw = await this.request("/v5/place/text", {
      keywords: keyword,
      region: city,
      city_limit: "true",
      page_size: String(limit),
      show_fields: "business,photos",
    });
    return this.parsePois(raw);
  }

  async searchAround(
    center: Coordinate,
    keyword: string,
    radius: number,
    types = "",
    limit = 8,
  ): Promise<Place[]> {
    const raw = await this.request("/v5/place/around", {
      location: center.join(","),
      keywords: keyword,
      types,
      radius: String(radius),
      sortrule: "weight",
      page_size: String(limit),
      show_fields: "business,photos",
    });
    return this.parsePois(raw);
  }

  private parsePois(raw: unknown): Place[] {
    const parsed = z.object({ pois: z.array(z.unknown()).optional() }).parse(raw);
    return (parsed.pois ?? []).flatMap((item) => {
      const poi = poiSchema.safeParse(item);
      const place = poi.success ? toPlace(poi.data) : null;
      return place ? [place] : [];
    });
  }

  async walking(origin: Coordinate, destination: Coordinate): Promise<RouteResult> {
    const raw = await this.request("/v5/direction/walking", {
      origin: origin.join(","),
      destination: destination.join(","),
      show_fields: "cost,polyline",
    });
    const parsed = z
      .object({
        route: z.object({
          paths: z.array(
            z.object({
              distance: numeric,
              cost: z.object({ duration: numeric }).partial().optional(),
              steps: z.array(z.object({ polyline: text })).optional(),
            }),
          ),
        }),
      })
      .parse(raw);
    const path = parsed.route.paths[0];
    if (!path) {
      throw new AppError("upstream", "未找到步行路线");
    }
    const seconds = path.cost?.duration ?? null;
    return {
      minutes: seconds === null ? null : Math.max(1, Math.round(seconds / 60)),
      meters: path.distance,
      costCny: 0,
      path: (path.steps ?? []).flatMap((step) =>
        step.polyline ? parsePolyline(step.polyline) : [],
      ),
      summary: "步行",
    };
  }

  async driving(origin: Coordinate, destination: Coordinate): Promise<RouteResult> {
    const raw = await this.request("/v5/direction/driving", {
      origin: origin.join(","),
      destination: destination.join(","),
      show_fields: "cost,polyline",
    });
    const parsed = z
      .object({
        route: z.object({
          taxi_cost: numeric,
          paths: z.array(
            z.object({
              distance: numeric,
              cost: z.object({ duration: numeric }).partial().optional(),
              steps: z.array(z.object({ polyline: text })).optional(),
            }),
          ),
        }),
      })
      .parse(raw);
    const path = parsed.route.paths[0];
    if (!path) {
      throw new AppError("upstream", "未找到驾车路线");
    }
    const seconds = path.cost?.duration ?? null;
    return {
      minutes: seconds === null ? null : Math.max(1, Math.round(seconds / 60)),
      meters: path.distance,
      costCny: parsed.route.taxi_cost,
      path: (path.steps ?? []).flatMap((step) =>
        step.polyline ? parsePolyline(step.polyline) : [],
      ),
      summary: "打车",
    };
  }

  async transit(
    origin: Coordinate,
    destination: Coordinate,
    citycode: string,
  ): Promise<RouteResult | null> {
    const raw = await this.request("/v5/direction/transit/integrated", {
      origin: origin.join(","),
      destination: destination.join(","),
      city1: citycode,
      city2: citycode,
      strategy: "0",
      show_fields: "cost,polyline",
    });
    const parsed = z
      .object({
        route: z
          .object({
            transits: z
              .array(
                z
                  .object({
                    distance: numeric,
                    cost: z
                      .object({ duration: numeric, transit_fee: numeric })
                      .partial()
                      .optional(),
                    segments: z.array(z.unknown()).optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .optional(),
      })
      .parse(raw);
    const plan = parsed.route?.transits?.[0];
    if (!plan) {
      return null;
    }
    const seconds = plan.cost?.duration ?? null;
    const lines: string[] = [];
    const path: Coordinate[] = [];
    collectTransit(plan.segments ?? [], lines, path);
    return {
      minutes: seconds === null ? null : Math.max(1, Math.round(seconds / 60)),
      meters: plan.distance,
      costCny: plan.cost?.transit_fee ?? null,
      path,
      summary: lines.length ? lines.join(" → ") : "公交/地铁",
    };
  }

  async weather(adcode: string): Promise<Weather[]> {
    const raw = await this.request("/v3/weather/weatherInfo", {
      city: adcode,
      extensions: "all",
    });
    const parsed = z
      .object({
        forecasts: z.array(
          z.object({
            casts: z.array(
              z.object({
                date: z.string(),
                dayweather: z.string(),
                nightweather: z.string(),
                daytemp: z.string(),
                nighttemp: z.string(),
                daywind: z.string(),
                daypower: z.string(),
              }),
            ),
          }),
        ),
      })
      .parse(raw);
    return (parsed.forecasts[0]?.casts ?? []).map((cast) => ({
      date: cast.date,
      dayWeather: cast.dayweather,
      nightWeather: cast.nightweather,
      high: Number(cast.daytemp),
      low: Number(cast.nighttemp),
      wind: `${cast.daywind}风 ${cast.daypower}级`,
    }));
  }
}

/** 公交方案的分段结构较深，这里只提取线路名称与真实折线 */
function collectTransit(segments: unknown[], lines: string[], path: Coordinate[]) {
  for (const segment of segments) {
    if (!segment || typeof segment !== "object") {
      continue;
    }
    const record = segment as Record<string, unknown>;
    const bus = record.bus as { buslines?: { name?: string }[] } | undefined;
    const busName = bus?.buslines?.[0]?.name;
    if (busName) {
      lines.push(busName.replace(/\(.*\)$/, ""));
    }
    const railway = record.railway as { name?: string } | undefined;
    if (railway?.name) {
      lines.push(railway.name);
    }
    walkPolylines(record, path);
  }
}

function walkPolylines(value: unknown, path: Coordinate[]) {
  if (Array.isArray(value)) {
    value.forEach((item) => walkPolylines(item, path));
    return;
  }
  if (!value || typeof value !== "object") {
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    if (key === "polyline" && typeof child === "string") {
      path.push(...parsePolyline(child));
    } else if (key === "polyline" && child && typeof child === "object") {
      const inner = (child as { polyline?: unknown }).polyline;
      if (typeof inner === "string") {
        path.push(...parsePolyline(inner));
      }
    } else {
      walkPolylines(child, path);
    }
  }
}

export function amapFromEnv(): AmapClient {
  const key = process.env.AMAP_WEB_SERVICE_KEY;
  if (!key) {
    throw new AppError(
      "not_configured",
      "服务端未配置高德 Web 服务 Key（AMAP_WEB_SERVICE_KEY）",
    );
  }
  return new AmapClient(key);
}
