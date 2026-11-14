/**
 * Agent 可调用的工具（Function Calling）。
 * 每个工具 = 参数 Schema（Zod → JSON Schema 交给模型）+ 执行器（服务端真实调用）+ 前端展示文案。
 * 工具结果只返回精简字段，降低 token 消耗，也避免把供应商原始响应交给模型。
 */
import { z } from "zod";
import { clusterByArea, distanceMeters, orderByShortestPath } from "@/lib/geo";
import { requiredMeals } from "@/lib/schedule";
import { toClock, toMinutes } from "@/lib/time";
import type { Place, Station, Train } from "@/lib/schema";
import { addDays } from "@/lib/time";
import { webSearch, webSearchConfigured } from "@/server/providers/websearch";
import { hasCityKnowledge, retrieve } from "@/server/rag/retriever";
import type { ToolSpec } from "@/server/llm/client";
import { assembleTrip, buildDay, dayToDraft } from "./enrich";
import { cleanText, cleanList } from "./guard";
import type { AgentSession, DayDraft } from "./session";

/** 城市主要火车站（缓存于会话）：用作跨城铁路查询的起终点 */
async function stationOf(
  session: AgentSession,
  city: string,
): Promise<{ location: Place["location"]; citycode: string } | null> {
  const cached = session.stations.get(city);
  if (cached !== undefined) {
    return cached;
  }
  session.amapCalls += 1;
  const places = await session.amap.searchText(city, "火车站", 5).catch(() => []);
  const station =
    places.find((place) => /站$/.test(place.name) && place.citycode) ??
    places.find((place) => place.citycode);
  const result = station?.citycode
    ? { location: station.location, citycode: station.citycode }
    : null;
  session.stations.set(city, result);
  return result;
}

/** 在目的地城市定位具体车站（如“杭州东”），用于第一天从站出发、最后一天前往车站 */
async function locateStation(
  session: AgentSession,
  name: string,
): Promise<Station | null> {
  session.amapCalls += 1;
  const places = await session.amap
    .searchText(session.request.city, `${name}站`, 3)
    .catch(() => []);
  const match = places.find((place) => place.name.startsWith(name)) ?? places[0];
  return match
    ? { name: match.name, location: match.location, citycode: match.citycode }
    : null;
}

const MAX_SIGHTS: Record<string, number> = { relaxed: 3, balanced: 4, packed: 6 };
/** 同一天最多提交次数，超过后要求模型接受结果继续，避免死循环 */
const MAX_DAY_ATTEMPTS = 3;

function compactPlace(place: Place, origin?: Place) {
  return {
    id: place.id,
    name: place.name,
    type: place.type,
    rating: place.rating,
    avgCost: place.avgCost,
    open: place.openTime,
    address: place.address,
    lnglat: place.location.map((n) => n.toFixed(4)).join(","),
    ...(place.signatureDishes.length
      ? { signatureDishes: place.signatureDishes.slice(0, 6) }
      : {}),
    ...(origin
      ? { distanceM: Math.round(distanceMeters(origin.location, place.location)) }
      : {}),
  };
}

const searchKnowledgeArgs = z.object({
  query: z.string().min(1).max(60).describe("检索问题，如“西湖 游览 分区”“亲子 节奏”"),
});

const searchPlacesArgs = z.object({
  keyword: z.string().min(1).max(30).describe("地点名称或类别关键词，如“博物馆”“灵隐寺”"),
});

const searchNearbyArgs = z.object({
  placeId: z.string().describe("作为中心的已知地点 ID"),
  keyword: z.string().min(1).max(30).describe("如“杭帮菜”“小吃”“咖啡”"),
  radius: z.number().int().min(200).max(3000).default(1200),
});

const arrangeArgs = z.object({
  placeIds: z.array(z.string()).min(2).max(30),
  groups: z.number().int().min(1).max(7).describe("希望分成的组数，通常等于天数"),
});

const stopArgs = z.object({
  placeId: z.string(),
  kind: z.enum(["sight", "meal", "rest"]),
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable().default(null),
  durationMin: z.number().int().min(15).max(480),
  title: z.string().max(30).describe("简短标题，如“灵隐寺·飞来峰石窟”"),
  description: z.string().max(220).describe("为什么去、玩什么，2-3 句"),
  highlights: z.array(z.string().max(30)).max(4).default([]),
  tips: z.array(z.string().max(60)).max(3).default([]),
  ticketCny: z
    .number()
    .min(0)
    .max(5000)
    .nullable()
    .default(null)
    .describe("每人门票估算，免费填 0，不确定填 null"),
  mealCny: z.number().min(0).max(5000).nullable().default(null).describe("每人餐费估算"),
  dishes: z
    .array(z.string().max(16))
    .max(4)
    .default([])
    .describe(
      "推荐菜 2-4 道：优先从该餐厅的 signatureDishes（高德招牌菜）中挑选，并避开忌口",
    ),
  citations: z.array(z.string()).max(4).default([]).describe("引用的知识库条目 ID"),
  ticketSourceId: z
    .string()
    .nullable()
    .default(null)
    .describe(
      "门票价格若来自 verify_ticket 的结果，填对应来源 id（如 S3）；估算则填 null",
    ),
});

const saveDayArgs = z.object({
  day: z.number().int().min(1),
  theme: z.string().max(20).describe("当日主题，4-10 字"),
  summary: z.string().max(160),
  stops: z.array(stopArgs).min(2).max(10),
});

const setHotelArgs = z.object({
  placeId: z.string().describe("通过 search_places / search_nearby 搜到的酒店 ID"),
  reason: z.string().max(120).describe("为什么住这里：离哪些景点近、交通如何"),
  pricePerNightCny: z
    .number()
    .min(0)
    .max(20000)
    .nullable()
    .default(null)
    .describe("每间每晚参考价"),
});

const verifyTicketArgs = z.object({
  placeId: z.string().describe("要核对门票的景点 ID"),
});

const MAX_TICKET_CHECKS = 8;

const searchTrainsArgs = z.object({
  direction: z
    .enum(["outbound", "return"])
    .describe("outbound=去程（第一天），return=返程（最后一天）"),
  earliest: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .describe("最早出发时间 HH:mm，去程一般 07:00 起，返程一般 13:00 起"),
});

const setTrainsArgs = z.object({
  outboundId: z
    .string()
    .nullable()
    .describe("选中的去程车次 id；没有合适铁路方案时填 null"),
  returnId: z
    .string()
    .nullable()
    .describe("选中的返程车次 id；没有合适铁路方案时填 null"),
  note: z.string().max(120).describe("为什么选这两趟车，或没有铁路方案时的出行建议"),
});

const finalizeArgs = z.object({
  title: z.string().max(30),
  subtitle: z.string().max(60),
  overview: z.string().max(400),
  tips: z
    .array(
      z.object({
        text: z.string().max(120),
        citations: z.array(z.string()).max(3).default([]),
      }),
    )
    .max(8)
    .default([]),
  packing: z.array(z.string().max(20)).max(12).default([]),
  hotelPerNightCny: z
    .number()
    .min(0)
    .max(20000)
    .nullable()
    .default(null)
    .describe("可选：覆盖 set_hotel 给出的每间每晚参考价"),
  hotelNote: z.string().max(80).default("").describe("住宿区域建议"),
  changeSummary: z
    .string()
    .max(200)
    .nullable()
    .default(null)
    .describe("调整模式下说明改了什么"),
});

export interface ToolOutcome {
  ok: boolean;
  /** 返回给模型的内容（JSON 字符串） */
  content: string;
  /** 给前端的一句话摘要 */
  summary: string;
  places?: Place[];
  finished?: boolean;
}

interface ToolDefinition<T extends z.ZodType> {
  schema: T;
  description: string;
  label: (args: z.infer<T>, session: AgentSession) => string;
  run: (args: z.infer<T>, session: AgentSession) => Promise<ToolOutcome>;
}

function define<T extends z.ZodType>(definition: ToolDefinition<T>) {
  return definition;
}

const ok = (
  data: unknown,
  summary: string,
  extra: Partial<ToolOutcome> = {},
): ToolOutcome => ({
  ok: true,
  content: JSON.stringify(data),
  summary,
  ...extra,
});
const fail = (message: string): ToolOutcome => ({
  ok: false,
  content: JSON.stringify({ error: message }),
  summary: message,
});

export const tools = {
  search_knowledge: define({
    schema: searchKnowledgeArgs,
    description:
      "检索行间旅行知识库（RAG），获取目的地玩法、分区、美食、预约与注意事项。结果带 id，可在行程中引用。",
    label: (args) => `检索知识库：${args.query}`,
    run: async (args, session) => {
      const hits = retrieve(args.query, session.request.city);
      hits.forEach((hit) => session.knowledge.set(hit.id, hit));
      const covered = hasCityKnowledge(session.request.city);
      return ok(
        {
          cityCovered: covered,
          results: hits.map((hit) => ({
            id: hit.id,
            title: hit.title,
            content: hit.content,
          })),
        },
        hits.length
          ? `命中 ${hits.length} 条：${hits.map((hit) => hit.title).join("、")}`
          : "知识库没有相关条目",
      );
    },
  }),
  search_places: define({
    schema: searchPlacesArgs,
    description:
      "用高德地图在目的地城市内搜索真实地点（景点、商圈、餐厅等），返回地点 ID、评分、营业时间、坐标。",
    label: (args) => `高德搜索：${args.keyword}`,
    run: async (args, session) => {
      session.amapCalls += 1;
      const places = await session.amap.searchText(session.request.city, args.keyword);
      session.register(places);
      return ok(
        places.map((place) => compactPlace(place)),
        places.length
          ? `找到 ${places.length} 个地点：${places
              .slice(0, 4)
              .map((p) => p.name)
              .join("、")}`
          : "没有找到匹配地点",
        { places },
      );
    },
  }),
  search_nearby: define({
    schema: searchNearbyArgs,
    description:
      "以某个已知地点为中心，用高德搜索周边餐厅或设施，适合安排顺路的午餐、晚餐。",
    label: (args, session) =>
      `周边搜索：${session.places.get(args.placeId)?.name ?? "地点"}附近的${args.keyword}`,
    run: async (args, session) => {
      const center = session.places.get(args.placeId);
      if (!center) {
        return fail(`未知地点 ID ${args.placeId}，请先用 search_places 获取`);
      }
      session.amapCalls += 1;
      const places = await session.amap.searchAround(
        center.location,
        args.keyword,
        args.radius,
      );
      session.register(places);
      return ok(
        places.map((place) => compactPlace(place, center)),
        places.length ? `${center.name}周边找到 ${places.length} 家` : "周边没有匹配结果",
        { places },
      );
    },
  }),
  get_weather: define({
    schema: z.object({}),
    description:
      "查询目的地未来几天的天气预报（高德），用于决定户外/室内安排。只覆盖近 4 天，超出范围返回未知。",
    label: () => "查询天气预报",
    run: async (_args, session) => {
      let adcode =
        [...session.places.values()].find((place) => place.adcode)?.adcode ?? null;
      if (!adcode) {
        session.amapCalls += 1;
        const found = await session.amap.searchText(
          session.request.city,
          session.request.city,
          1,
        );
        adcode = found[0]?.adcode ?? null;
      }
      if (!adcode) {
        return fail("无法确定城市行政编码，天气未知");
      }
      session.amapCalls += 1;
      session.weather = await session.amap.weather(adcode);
      const dates = Array.from({ length: session.request.days }, (_, i) =>
        addDays(session.request.startDate, i),
      );
      const result = dates.map((date) => {
        const cast = session.weather?.find((item) => item.date === date);
        return cast
          ? { date, weather: cast.dayWeather, high: cast.high, low: cast.low }
          : { date, weather: "超出预报范围，未知" };
      });
      const known = result.filter((item) => "high" in item).length;
      return ok(
        result,
        known ? `取得 ${known}/${dates.length} 天预报` : "行程日期超出预报范围，天气未知",
      );
    },
  }),
  verify_ticket: define({
    schema: verifyTicketArgs,
    description:
      "联网搜索景点的门票价格与预约政策，结果标注是否为官方来源（政府/景区官网）。只对收费景点调用；采用官方来源的价格，并在 save_day_plan 的 ticketSourceId 中引用来源 id。",
    label: (args, session) =>
      `联网核对门票：${session.places.get(args.placeId)?.name ?? "景点"}`,
    run: async (args, session) => {
      const place = session.places.get(args.placeId);
      if (!place) {
        return fail(`未知地点 ID ${args.placeId}`);
      }
      if (!webSearchConfigured()) {
        return fail("联网核对未开启，门票请按估算填写并保持 ticketSourceId 为 null");
      }
      if (session.ticketChecks >= MAX_TICKET_CHECKS) {
        return fail(`本次最多核对 ${MAX_TICKET_CHECKS} 个景点，其余按估算`);
      }
      session.ticketChecks += 1;
      const results = await webSearch(
        `${session.request.city} ${place.name} 门票价格 预约 官网`,
      );
      const items = results.slice(0, 5).map((result) => {
        const id = `S${session.verifiedSources.size + 1}`;
        session.verifiedSources.set(id, {
          url: result.url,
          title: result.title,
          official: result.official,
        });
        return {
          id,
          official: result.official,
          title: result.title,
          site: new URL(result.url).hostname,
          snippet: result.snippet,
        };
      });
      const official = items.filter((item) => item.official).length;
      return ok(
        {
          place: place.name,
          results: items,
          hint: "摘要只是网页片段，价格以官方来源为准；不确定时仍填估算",
        },
        items.length
          ? `找到 ${items.length} 条，其中官方来源 ${official} 条`
          : "没有搜到相关信息",
      );
    },
  }),
  search_trains: define({
    schema: searchTrainsArgs,
    description:
      "查询出发城市与目的地之间的铁路车次（高德跨城公交规划：车次、站点、时刻、各席别票价，不含余票）。用户填写了出发城市时，规划前先查去程和返程。",
    label: (args, session) =>
      args.direction === "outbound"
        ? `查询去程车次：${session.request.origin} → ${session.request.city}`
        : `查询返程车次：${session.request.city} → ${session.request.origin}`,
    run: async (args, session) => {
      if (!session.needsTrains()) {
        return fail("用户没有填写出发城市，不需要查询车次");
      }
      const [origin, destination] = await Promise.all([
        stationOf(session, session.request.origin),
        stationOf(session, session.request.city),
      ]);
      if (!origin || !destination) {
        return fail("没有找到出发地或目的地的火车站");
      }
      const outbound = args.direction === "outbound";
      const [from, to] = outbound ? [origin, destination] : [destination, origin];
      const date = outbound
        ? session.request.startDate
        : addDays(session.request.startDate, session.request.days - 1);
      const start = toMinutes(args.earliest) ?? (outbound ? 420 : 780);
      const found = new Map<string, Train>();
      for (const offset of [0, 150, 300]) {
        const minute = Math.min(start + offset, 22 * 60);
        session.amapCalls += 1;
        const options = await session.amap
          .railOptions(
            from.location,
            to.location,
            from.citycode,
            to.citycode,
            date,
            toClock(minute),
          )
          .catch(() => []);
        for (const option of options) {
          if (!found.has(option.trip) && (toMinutes(option.depart) ?? 0) >= start) {
            found.set(option.trip, { ...option, date });
          }
        }
      }
      const trains = [...found.values()]
        .sort((a, b) => a.depart.localeCompare(b.depart))
        .slice(0, 6);
      const prefix = outbound ? "out" : "ret";
      for (const train of trains) {
        session.trainOptions.set(`${prefix}-${train.trip}`, train);
      }
      if (!trains.length) {
        return ok(
          {
            trains: [],
            hint: "没有找到铁路方案（可能需要飞机或多次换乘），可在 set_trains 中填 null 并在 note 说明",
          },
          "没有找到铁路方案",
        );
      }
      return ok(
        {
          date,
          trains: trains.map((train) => ({
            id: `${prefix}-${train.trip}`,
            trip: train.trip,
            from: train.from,
            to: train.to,
            depart: train.depart,
            arrive: `${train.arrive}${train.arriveNextDay ? "（次日）" : ""}`,
            minutes: train.minutes,
            lowestPrice: train.seats[0]?.price ?? null,
            doorToDoorMinutes: train.doorToDoorMinutes,
          })),
        },
        `找到 ${trains.length} 趟：${trains
          .slice(0, 3)
          .map((train) => `${train.trip} ${train.depart}`)
          .join("、")}`,
      );
    },
  }),
  set_trains: define({
    schema: setTrainsArgs,
    description:
      "从 search_trains 的结果中选定去程和返程车次。选定后第一天从到站时间开始安排、最后一天在返程发车前 1.5 小时结束，返回更新后的每日约束。",
    label: (args, session) => {
      const names = [args.outboundId, args.returnId]
        .map((id) => (id ? session.trainOptions.get(id)?.trip : null))
        .filter(Boolean);
      return names.length ? `确定往返车次：${names.join(" / ")}` : "确定往返交通";
    },
    run: async (args, session) => {
      const pick = (id: string | null, prefix: string) => {
        if (!id) {
          return null;
        }
        if (!id.startsWith(prefix) || !session.trainOptions.has(id)) {
          throw new Error(`车次 ${id} 不在 search_trains 的结果中`);
        }
        return session.trainOptions.get(id) ?? null;
      };
      let outbound: Train | null;
      let inbound: Train | null;
      try {
        outbound = pick(args.outboundId, "out-");
        inbound = pick(args.returnId, "ret-");
      } catch (error) {
        return fail(error instanceof Error ? error.message : "车次无效");
      }
      const [arrivalStation, departureStation] = await Promise.all([
        outbound ? locateStation(session, outbound.to) : null,
        inbound ? locateStation(session, inbound.from) : null,
      ]);
      session.intercity = {
        origin: session.request.origin,
        outbound,
        inbound,
        note: cleanText(args.note),
        arrivalStation,
        departureStation,
      };
      if (session.days.size) {
        session.staleDays = new Set(session.days.keys());
      }
      const { days } = session.request;
      return ok(
        {
          day1Start: session.effectiveArrival()
            ? `${session.effectiveArrival()} 到站，约 1 小时后开始游玩`
            : "不限",
          lastDayEnd: session.effectiveDeparture()
            ? `${session.effectiveDeparture()} 发车，最后一站需在发车前 1.5 小时结束`
            : "不限",
          requiredMeals: Array.from({ length: days }, (_, i) => {
            const meals = requiredMeals(
              i + 1,
              days,
              session.effectiveArrival(),
              session.effectiveDeparture(),
            );
            return `第${i + 1}天：${meals.length ? meals.map((meal) => (meal === "lunch" ? "午餐" : "晚餐")).join("、") : "无硬性要求"}`;
          }),
        },
        [
          outbound && `去程 ${outbound.trip} ${outbound.depart}→${outbound.arrive}`,
          inbound && `返程 ${inbound.trip} ${inbound.depart}`,
        ]
          .filter(Boolean)
          .join("，") || "不乘火车",
      );
    },
  }),
  set_hotel: define({
    schema: setHotelArgs,
    description:
      "多日行程必须先确定住宿：选择位于行程重心、交通方便的酒店（用户已指定酒店时用它）。之后每天会自动计算从酒店出发与返回的交通。",
    label: (args, session) =>
      `确定住宿：${session.places.get(args.placeId)?.name ?? "酒店"}`,
    run: async (args, session) => {
      const place = session.places.get(args.placeId);
      if (!place) {
        return fail(`未知地点 ID ${args.placeId}，请先搜索酒店`);
      }
      if (place.category !== "hotel" && place.category !== "other") {
        return fail(`${place.name} 不是住宿类地点，请搜索“酒店”`);
      }
      const changed = session.hotel?.place.id !== place.id;
      session.hotel = {
        place,
        reason: cleanText(args.reason),
        pricePerNightCny: args.pricePerNightCny,
        userProvided: Boolean(session.request.hotelName),
      };
      if (changed) {
        session.staleDays = new Set(session.days.keys());
      }
      return ok({ hotel: place.name }, `住在${place.name}`);
    },
  }),
  arrange_places: define({
    schema: arrangeArgs,
    description:
      "空间编排算法：按地理位置把候选地点分组（k-means），组内按最短路径排序，并给出组内总直线距离。用于决定每天去哪些地点、按什么顺序。",
    label: (args) => `空间编排：${args.placeIds.length} 个地点分 ${args.groups} 组`,
    run: async (args, session) => {
      const known = args.placeIds
        .map((id) => session.places.get(id))
        .filter((place): place is Place => Boolean(place));
      if (known.length < 2) {
        return fail("可用地点不足两个，请先搜索地点");
      }
      const groups = clusterByArea(known, args.groups).map((group) => {
        const ordered = orderByShortestPath(group);
        let total = 0;
        for (let i = 1; i < ordered.length; i += 1) {
          total += distanceMeters(ordered[i - 1].location, ordered[i].location);
        }
        return {
          order: ordered.map((place) => ({ id: place.id, name: place.name })),
          straightLineKm: Math.round(total / 100) / 10,
        };
      });
      return ok(
        { groups },
        `分为 ${groups.length} 组：${groups.map((g) => g.order.length).join(" / ")} 个地点`,
      );
    },
  }),
  save_day_plan: define({
    schema: saveDayArgs,
    description:
      "提交某一天的完整安排（按时间顺序的景点与餐饮）。服务端会校验地点 ID、用真实路线计算交通与时刻并返回冲突；如有问题请修改后重新提交同一天。",
    label: (args) => `编排第 ${args.day} 天：${args.theme}`,
    run: async (args, session) => {
      const { days, pace } = session.request;
      if (args.day > days) {
        return fail(`行程只有 ${days} 天，day 超出范围`);
      }
      if (session.needsTrains() && !session.intercity) {
        return fail(
          "用户填写了出发城市，请先用 search_trains 查询往返车次并调用 set_trains，再提交每天安排",
        );
      }
      if (session.needsHotel() && !session.hotel) {
        return fail("多日行程请先搜索酒店并调用 set_hotel 确定住宿，再提交每天安排");
      }
      const errors: string[] = [];
      const submitted = new Set(args.stops.map((stop) => stop.placeId));
      for (const locked of session.lockedPlaceIds(args.day)) {
        if (!submitted.has(locked)) {
          errors.push(
            `${session.places.get(locked)?.name ?? locked} 已被用户锁定，必须保留在这一天`,
          );
        }
      }
      for (const stop of args.stops) {
        if (!session.places.has(stop.placeId)) {
          errors.push(`地点 ID ${stop.placeId} 不是检索结果中的真实地点`);
        }
      }
      const sights = args.stops.filter((stop) => stop.kind === "sight");
      if (!sights.length) {
        errors.push("每天至少安排一个景点或活动");
      }
      if (sights.length > MAX_SIGHTS[pace]) {
        errors.push(`当前节奏每天最多 ${MAX_SIGHTS[pace]} 个景点，请删减`);
      }
      const meals = new Set(args.stops.map((stop) => stop.mealType).filter(Boolean));
      const required = requiredMeals(
        args.day,
        days,
        session.effectiveArrival(),
        session.effectiveDeparture(),
      );
      const missing = required.filter((meal) => !meals.has(meal));
      if (missing.length) {
        errors.push(
          `这一天需要包含 ${missing.map((meal) => (meal === "lunch" ? "午餐（lunch）" : "晚餐（dinner）")).join("和")} 的 meal 站点`,
        );
      }
      const usedElsewhere = [...session.days.values()]
        .filter((day) => day.day !== args.day)
        .flatMap((day) =>
          day.stops.filter((stop) => stop.kind === "sight").map((stop) => stop.place.id),
        );
      for (const sight of sights) {
        if (usedElsewhere.includes(sight.placeId)) {
          errors.push(
            `${session.places.get(sight.placeId)?.name ?? sight.placeId} 已安排在其他天`,
          );
        }
      }
      if (errors.length) {
        return fail(`第 ${args.day} 天未通过校验：${errors.join("；")}`);
      }
      const draft: DayDraft = {
        day: args.day,
        theme: cleanText(args.theme),
        summary: cleanText(args.summary),
        stops: args.stops.map((stop) => ({
          ...stop,
          locked: session.lockedPlaceIds(args.day).includes(stop.placeId),
          mealType: stop.kind === "meal" ? (stop.mealType ?? "snack") : null,
          title: cleanText(stop.title),
          description: cleanText(stop.description),
          highlights: cleanList(stop.highlights),
          tips: cleanList(stop.tips),
          dishes: cleanList(stop.dishes),
        })),
      };
      const attempts = (session.saveAttempts.get(args.day) ?? 0) + 1;
      if (attempts > MAX_DAY_ATTEMPTS + 1) {
        return fail(
          `第 ${args.day} 天已提交过多次，请保留现有安排，继续其他天或调用 finalize_trip`,
        );
      }
      session.saveAttempts.set(args.day, attempts);
      const day = await buildDay(session, draft);
      session.days.set(day.day, day);
      session.staleDays.delete(day.day);
      session.emit({ type: "day", day });
      const conflicts = [
        ...day.warnings,
        ...day.stops.flatMap((stop) =>
          stop.warnings.map((w) => `${stop.place.name}：${w}`),
        ),
      ];
      return ok(
        {
          saved: true,
          schedule: day.stops.map(
            (stop) => `${stop.start}-${stop.end} ${stop.place.name}`,
          ),
          legs: day.legs.map((leg) => `${leg.mode} ${leg.minutes ?? "?"}分钟`),
          conflicts,
          ...(conflicts.length
            ? {
                note:
                  attempts >= MAX_DAY_ATTEMPTS
                    ? "这一天已调整多次，请接受当前安排并继续下一步，剩余冲突会提示给用户。"
                    : "冲突能通过调整顺序、删减或替换解决时再重提；若无法解决（如赶车时间），接受即可，不要反复提交。",
              }
            : {}),
          remainingDays: Array.from({ length: days }, (_, i) => i + 1).filter(
            (d) => !session.days.has(d),
          ),
        },
        conflicts.length
          ? `已排程 ${day.stops.length} 站，${conflicts.length} 处提醒`
          : `已排程 ${day.stops.length} 站，${day.stops[0]?.start}—${day.stops[day.stops.length - 1]?.end}`,
      );
    },
  }),
  finalize_trip: define({
    schema: finalizeArgs,
    description:
      "所有天数提交后调用，给出行程标题、总览、贴士、行李清单与住宿参考价，完成规划。",
    label: () => "汇总行程与预算",
    run: async (args, session) => {
      const missing = Array.from(
        { length: session.request.days },
        (_, i) => i + 1,
      ).filter((day) => !session.days.has(day));
      if (missing.length) {
        return fail(`还有第 ${missing.join("、")} 天未提交 save_day_plan`);
      }
      const previous = session.previous;
      // 住宿变更后，未重新提交的天需要按新酒店重算往返交通
      for (const dayNumber of session.staleDays) {
        const existing = session.days.get(dayNumber);
        if (existing) {
          const rebuilt = await buildDay(session, dayToDraft(existing));
          session.days.set(dayNumber, rebuilt);
          session.emit({ type: "day", day: rebuilt });
        }
      }
      session.staleDays.clear();
      const trip = assembleTrip(session, {
        title: cleanText(args.title) || previous?.title || `${session.request.city}之旅`,
        subtitle: cleanText(args.subtitle) || previous?.subtitle || "",
        overview: cleanText(args.overview) || previous?.overview || "",
        tips: args.tips.length
          ? args.tips.map((tip) => ({
              text: cleanText(tip.text),
              citations: tip.citations,
            }))
          : (previous?.tips ?? []),
        packing: args.packing.length
          ? cleanList(args.packing)
          : (previous?.packing ?? []),
        hotelPerNightCny: args.hotelPerNightCny,
        hotelNote: cleanText(args.hotelNote),
        changeSummary: args.changeSummary ? cleanText(args.changeSummary) : null,
      });
      session.finalTrip = trip;
      return ok(
        { done: true },
        `完成：${trip.days.length} 天，人均约 ¥${trip.budget.total}`,
        { finished: true },
      );
    },
  }),
};

export type ToolName = keyof typeof tools;

export function toolSpecs(): ToolSpec[] {
  return Object.entries(tools).map(([name, tool]) => ({
    name,
    description: tool.description,
    parameters: z.toJSONSchema(tool.schema, { io: "input" }) as Record<string, unknown>,
  }));
}

export function isToolName(name: string): name is ToolName {
  return name in tools;
}
