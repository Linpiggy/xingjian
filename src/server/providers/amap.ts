/**
 * 高德 Web 服务适配器（服务端专用，Key 不出服务器）。
 * 只做：地点检索、周边检索、步行/公交/驾车路线、天气预报。
 * 所有响应都用 Zod 宽松解析，缺失字段归一为 null，而不是猜测值。
 */
import { z } from "zod";
import type { Coordinate, Place, Train, TrainLeg, Weather } from "@/lib/schema";
import { toMinutes } from "@/lib/time";
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
    .object({
      rating: numeric,
      cost: numeric,
      opentime_week: text,
      opentime_today: text,
      tag: text,
      tel: text,
    })
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

const GENERIC_TAGS =
  /^(特色菜|招牌菜|鸡肉|牛肉|猪肉|羊肉|鱼|鱼肉|虾|虾仁|海鲜|蔬菜|素菜|主食|小吃|饮品|甜品|酒水|单人餐|双人餐|三人餐|四人餐|多人餐|.*套餐.*)$/;

/** 从高德 tag 中提取招牌菜：去掉泛化词、重复与过长条目 */
export function parseSignatureDishes(tag: string | null): string[] {
  if (!tag) {
    return [];
  }
  const seen = new Set<string>();
  const dishes: string[] = [];
  for (const raw of tag.split(/[,，;；|]/)) {
    const dish = raw.trim().replace(/^精品/, "");
    if (!dish || dish.length > 12 || GENERIC_TAGS.test(dish) || seen.has(dish)) {
      continue;
    }
    seen.add(dish);
    dishes.push(dish);
    if (dishes.length === 8) {
      break;
    }
  }
  return dishes;
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
    signatureDishes:
      categoryOf(raw.typecode?.split("|")[0] ?? null) === "food"
        ? parseSignatureDishes(raw.business?.tag ?? null)
        : [],
    tel: raw.business?.tel?.split(";")[0]?.trim() || null,
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

  /**
   * 跨城铁路方案：高德跨城公交规划会返回途经的铁路分段（车次、站点、时刻、各席别票价）。
   * 只有时刻表与票价，不含余票；结果按出发时间排序、按车次去重。
   */
  async railOptions(
    origin: Coordinate,
    destination: Coordinate,
    fromCitycode: string,
    toCitycode: string,
    date: string,
    time: string,
  ): Promise<Omit<Train, "date">[]> {
    const raw = await this.request("/v5/direction/transit/integrated", {
      origin: origin.join(","),
      destination: destination.join(","),
      city1: fromCitycode,
      city2: toCitycode,
      date,
      time,
      strategy: "0",
      AlternativeRoute: "5",
      show_fields: "cost",
    });
    const stop = z.object({ name: z.string(), time: text }).partial();
    const railway = z.object({
      trip: z.string(),
      type: text,
      time: numeric,
      departure_stop: stop.optional(),
      arrival_stop: stop.optional(),
      spaces: z
        .array(z.object({ code: z.string(), cost: numeric }))
        .optional()
        .catch([]),
    });
    const parsed = z
      .object({
        route: z
          .object({
            transits: z
              .array(
                z
                  .object({
                    cost: z.object({ duration: numeric }).partial().optional(),
                    segments: z
                      .array(
                        z
                          .object({ railway: railway.optional().catch(undefined) })
                          .passthrough(),
                      )
                      .optional(),
                  })
                  .passthrough(),
              )
              .optional(),
          })
          .optional(),
      })
      .parse(raw);
    const clock = (value: string | null | undefined) =>
      value && /^\d{4}$/.test(value) ? `${value.slice(0, 2)}:${value.slice(2)}` : null;
    const results: Omit<Train, "date">[] = [];
    for (const transit of parsed.route?.transits ?? []) {
      const rails = (transit.segments ?? [])
        .map((segment) => segment.railway)
        .filter((rail): rail is z.infer<typeof railway> => Boolean(rail));
      const legs = buildLegs(rails, clock);
      if (!legs) {
        continue;
      }
      const first = legs[0];
      const last = legs[legs.length - 1];
      const startMinutes = (toMinutes(first.depart) ?? 0) + first.departDayOffset * 1440;
      const endMinutes = (toMinutes(last.arrive) ?? 0) + last.arriveDayOffset * 1440;
      results.push({
        trip: legs.map((leg) => leg.trip).join(" → "),
        type: legs.length > 1 ? `中转 ${legs.length - 1} 次` : first.type,
        from: first.from,
        to: last.to,
        depart: first.depart,
        arrive: last.arrive,
        arriveNextDay: last.arriveDayOffset > 0,
        arriveDayOffset: last.arriveDayOffset,
        minutes: endMinutes - startMinutes,
        seats: legs.length === 1 ? first.seats : [],
        legs,
        doorToDoorMinutes:
          transit.cost?.duration != null ? Math.round(transit.cost.duration / 60) : null,
      });
    }
    return results;
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

/**
 * 把一个跨城方案中的所有铁路分段转换为车次列表，并计算每段相对出发日的天数偏移。
 * 优先用分段运行时长推算到达日（可处理运行超过 24 小时的车次），没有时长时按时刻先后推断。
 */
function buildLegs(
  rails: {
    trip: string;
    type: string | null;
    time: number | null;
    departure_stop?: { name?: string; time?: string | null };
    arrival_stop?: { name?: string; time?: string | null };
    spaces?: { code: string; cost: number | null }[];
  }[],
  clock: (value: string | null | undefined) => string | null,
): TrainLeg[] | null {
  const legs: TrainLeg[] = [];
  let previousArrival: number | null = null;
  for (const rail of rails) {
    const depart = clock(rail.departure_stop?.time);
    const arrive = clock(rail.arrival_stop?.time);
    if (!depart || !arrive || !rail.departure_stop?.name || !rail.arrival_stop?.name) {
      return null;
    }
    const departClock = toMinutes(depart) ?? 0;
    const arriveClock = toMinutes(arrive) ?? 0;
    // 出发时刻：不早于上一段到达（同一天放不下就顺延到下一天）
    let departAbsolute = departClock;
    if (previousArrival !== null) {
      while (departAbsolute < previousArrival) {
        departAbsolute += 1440;
      }
    }
    let arriveAbsolute: number;
    if (rail.time !== null && rail.time > 0) {
      arriveAbsolute = departAbsolute + Math.round(rail.time / 60);
      // 用时长推算后再对齐到实际到达时刻，消除秒级取整误差
      const day = Math.floor(arriveAbsolute / 1440);
      const candidate = day * 1440 + arriveClock;
      arriveAbsolute =
        Math.abs(candidate - arriveAbsolute) <= 720 ? candidate : arriveAbsolute;
    } else {
      arriveAbsolute = departAbsolute - (departAbsolute % 1440) + arriveClock;
      if (arriveAbsolute < departAbsolute) {
        arriveAbsolute += 1440;
      }
    }
    previousArrival = arriveAbsolute;
    legs.push({
      trip: rail.trip,
      type: rail.type ?? "火车",
      from: rail.departure_stop.name,
      to: rail.arrival_stop.name,
      depart,
      arrive,
      departDayOffset: Math.floor(departAbsolute / 1440),
      arriveDayOffset: Math.floor(arriveAbsolute / 1440),
      minutes: arriveAbsolute - departAbsolute,
      seats: groupSeats(
        (rail.spaces ?? [])
          .filter(
            (seat): seat is { code: string; cost: number } =>
              seat.cost !== null && seat.cost > 0,
          )
          .map((seat) => ({
            name: seat.code.replace(/^火车/, ""),
            price: Math.round(seat.cost),
          })),
      ),
    });
  }
  return legs.length ? legs : null;
}

/** 同一席别合并为价格区间；无座排在最后，其余按最低价排序 */
export function groupSeats(seats: { name: string; price: number }[]): Train["seats"] {
  const grouped = new Map<string, { name: string; price: number; maxPrice: number }>();
  for (const seat of seats) {
    const current = grouped.get(seat.name);
    grouped.set(seat.name, {
      name: seat.name,
      price: Math.min(current?.price ?? seat.price, seat.price),
      maxPrice: Math.max(current?.maxPrice ?? seat.price, seat.price),
    });
  }
  return [...grouped.values()].sort(
    (a, b) =>
      Number(a.name.includes("无座")) - Number(b.name.includes("无座")) ||
      a.price - b.price,
  );
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
