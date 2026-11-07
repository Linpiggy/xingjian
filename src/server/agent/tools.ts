/**
 * Agent 可调用的工具（Function Calling）。
 * 每个工具 = 参数 Schema（Zod → JSON Schema 交给模型）+ 执行器（服务端真实调用）+ 前端展示文案。
 * 工具结果只返回精简字段，降低 token 消耗，也避免把供应商原始响应交给模型。
 */
import { z } from "zod";
import { clusterByArea, distanceMeters, orderByShortestPath } from "@/lib/geo";
import type { Place } from "@/lib/schema";
import { addDays } from "@/lib/time";
import { hasCityKnowledge, retrieve } from "@/server/rag/retriever";
import type { ToolSpec } from "@/server/llm/client";
import { assembleTrip, buildDay } from "./enrich";
import { cleanText, cleanList } from "./guard";
import type { AgentSession, DayDraft } from "./session";

const MAX_SIGHTS: Record<string, number> = { relaxed: 3, balanced: 4, packed: 6 };

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
  dishes: z.array(z.string().max(16)).max(4).default([]),
  citations: z.array(z.string()).max(4).default([]).describe("引用的知识库条目 ID"),
});

const saveDayArgs = z.object({
  day: z.number().int().min(1),
  theme: z.string().max(20).describe("当日主题，4-10 字"),
  summary: z.string().max(160),
  stops: z.array(stopArgs).min(2).max(10),
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
    .describe("每间每晚住宿参考价"),
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
      const errors: string[] = [];
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
      if (!meals.has("lunch") || !meals.has("dinner")) {
        errors.push("每天需要包含午餐（lunch）和晚餐（dinner）两个 meal 站点");
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
          mealType: stop.kind === "meal" ? (stop.mealType ?? "snack") : null,
          title: cleanText(stop.title),
          description: cleanText(stop.description),
          highlights: cleanList(stop.highlights),
          tips: cleanList(stop.tips),
          dishes: cleanList(stop.dishes),
        })),
      };
      const day = await buildDay(session, draft);
      session.days.set(day.day, day);
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
