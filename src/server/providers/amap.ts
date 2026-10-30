import { z } from "zod";
import type {
  Coordinate,
  Place,
  PlaceProvider,
  Route,
  RouteMode,
  RouteProvider,
  Source,
} from "@/domain/models";
import { coordinateSchema } from "@/lib/contracts";
import { ProviderError } from "./errors";
import { withProviderBudget } from "./budget";

const envelope = z
  .object({ status: z.string(), infocode: z.string().optional() })
  .passthrough();
const optionalText = z.string().trim().min(1).nullable().catch(null);
const poi = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  location: z.string(),
  address: optionalText,
  citycode: optionalText,
  business: z.object({ opentime_week: optionalText }).catch({ opentime_week: null }),
});
const searchResponse = z.object({ pois: z.array(poi) });
const scalar = z.union([z.string(), z.number(), z.null()]).optional();
const routeResponse = z.object({
  route: z.object({
    paths: z.array(
      z.object({
        distance: scalar,
        cost: z.object({ duration: scalar }).optional(),
        steps: z.array(z.object({ polyline: z.string().optional() })).optional(),
      }),
    ),
  }),
});

export function parseCoordinate(value: string): Coordinate | null {
  if (!/^[-+]?\d+(?:\.\d+)?,[-+]?\d+(?:\.\d+)?$/.test(value)) {
    return null;
  }
  const result = coordinateSchema.safeParse(value.split(",").map(Number));
  return result.success ? result.data : null;
}
function nonnegative(value: string | number | null | undefined): number | null {
  if (value == null || (typeof value === "string" && !value.trim())) {
    return null;
  }
  const result = Number(value);
  return Number.isFinite(result) && result >= 0 ? result : null;
}
function source(): Source {
  return {
    kind: "provider",
    provider: "amap",
    queriedAt: new Date().toISOString(),
    coordinateSystem: "GCJ-02",
  };
}

/** 高德个人 Key 的并发配额很低（实测 10 并发里一半返回 10021），这里统一串行并留间隔 */
const MIN_INTERVAL_MS = 420;
const RATE_INFCODES = new Set(["10004", "10021"]);
const QUOTA_INFCODES = new Set(["10003", "10044", "10045"]);
const PERMISSION_INFCODES = new Set([
  "10001",
  "10005",
  "10006",
  "10007",
  "10008",
  "10009",
  "10012",
  "10013",
]);

let gate: Promise<unknown> = Promise.resolve();
let lastCallAt = 0;

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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class AmapProvider implements PlaceProvider, RouteProvider {
  constructor(
    private readonly key: string,
    private readonly transport: typeof fetch = fetch,
  ) {}
  private async request(
    path: string,
    params: Record<string, string>,
    signal?: AbortSignal,
    recovered = false,
  ): Promise<unknown> {
    if (!this.key) {
      throw new ProviderError("not_configured", "请在本地配置高德 Web 服务 Key。");
    }
    return withProviderBudget(() =>
      throttle(async () => {
        const url = new URL(path, "https://restapi.amap.com");
        url.search = new URLSearchParams({ ...params, key: this.key }).toString();
        try {
          const response = await this.transport(url, {
            cache: "no-store",
            redirect: "error",
            signal: signal
              ? AbortSignal.any([signal, AbortSignal.timeout(8000)])
              : AbortSignal.timeout(8000),
          });
          if (!response.ok) {
            throw new ProviderError(
              "unavailable",
              "高德服务暂时不可用。",
              response.status === 429 ? "rate_limited" : "upstream_http",
            );
          }
          const text = await response.text();
          if (text.length > 3_000_000) {
            throw new ProviderError("unavailable", "高德响应超出大小限制。");
          }
          const raw: unknown = JSON.parse(text);
          const result = envelope.safeParse(raw);
          if (!result.success) {
            throw new ProviderError("unavailable", "高德响应格式异常。");
          }
          if (result.data.status !== "1") {
            const code = result.data.infocode ?? "unknown";
            if (PERMISSION_INFCODES.has(code)) {
              throw new ProviderError(
                "permission_denied",
                "高德凭据或接口权限需检查。",
                code,
              );
            }
            if (QUOTA_INFCODES.has(code)) {
              throw new ProviderError(
                "unavailable",
                "高德今日调用配额已用尽，请明天再试或更换 Key。",
                "amap_quota_exceeded",
              );
            }
            if (RATE_INFCODES.has(code)) {
              throw new ProviderError(
                "unavailable",
                "高德访问频率受限。",
                "amap_rate_limited",
                2,
              );
            }
            throw new ProviderError("unavailable", "高德请求未成功，请稍后重试。", code);
          }
          return raw;
        } catch (error) {
          if (error instanceof ProviderError) {
            // 频率受限是并发/节奏问题，退避重试一次即可，不涉及模型计费
            if (error.code === "amap_rate_limited" && !recovered) {
              await sleep(800);
              return this.request(path, params, signal, true);
            }
            throw error;
          }
          throw new ProviderError(
            "unavailable",
            "高德请求超时、网络异常或返回格式错误。",
          );
        }
      }),
    );
  }
  async search(city: string, keyword: string, signal?: AbortSignal): Promise<Place[]> {
    const raw = await this.request(
      "/v5/place/text",
      {
        keywords: keyword,
        region: city,
        city_limit: "true",
        page_size: "5",
        show_fields: "business",
      },
      signal,
    );
    const parsed = searchResponse.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError("unavailable", "高德地点响应格式异常。");
    }
    return parsed.data.pois.flatMap((p) => {
      const location = parseCoordinate(p.location);
      return location
        ? [
            {
              id: p.id,
              name: p.name,
              location,
              citycode: p.citycode,
              address: p.address,
              openingHours: p.business.opentime_week,
              source: source(),
            },
          ]
        : [];
    });
  }
  async route(
    origin: Coordinate,
    destination: Coordinate,
    mode: RouteMode,
    signal?: AbortSignal,
  ): Promise<Route> {
    // v5 只有步行与驾车两条可直接消费的接口；公交需要城市对，暂不在此处伪造
    const path = mode === "driving" ? "/v5/direction/driving" : "/v5/direction/walking";
    const raw = await this.request(
      path,
      {
        origin: origin.join(","),
        destination: destination.join(","),
        show_fields: "cost,polyline",
      },
      signal,
    );
    const parsed = routeResponse.safeParse(raw);
    if (!parsed.success) {
      throw new ProviderError("unavailable", "高德路线响应格式异常。");
    }
    const leg = parsed.data.route.paths[0];
    if (!leg) {
      throw new ProviderError("unavailable", "两地之间未返回可用路线。", "no_route");
    }
    const segments = (leg.steps ?? []).flatMap((step) => {
      if (!step.polyline) {
        return [];
      }
      const points = step.polyline.split(";").map(parseCoordinate);
      // Never connect across malformed or missing segments with an invented straight line.
      return points.length >= 2 && points.every((p) => p !== null)
        ? [points as Coordinate[]]
        : [];
    });
    return {
      mode: mode === "driving" ? "driving" : "walking",
      meters: nonnegative(leg.distance),
      seconds: nonnegative(leg.cost?.duration),
      segments,
      detail: mode === "driving" ? "打车／驾车参考，未含实时路况与计价" : null,
      source: source(),
    };
  }
}
