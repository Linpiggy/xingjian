/**
 * 前后端共享的数据契约。
 * 所有进入页面的行程数据都先经过这里的 Zod 校验，类型由 schema 推导，避免两份定义漂移。
 */
import { z } from "zod";

/** 高德使用 GCJ-02 坐标：[经度, 纬度] */
export const coordinateSchema = z.tuple([
  z.number().min(73).max(136),
  z.number().min(3).max(54),
]);
export type Coordinate = z.infer<typeof coordinateSchema>;

export const paceSchema = z.enum(["relaxed", "balanced", "packed"]);
export type Pace = z.infer<typeof paceSchema>;

export const travelerSchema = z.enum(["solo", "couple", "friends", "family", "elderly"]);
export type Traveler = z.infer<typeof travelerSchema>;

export const INTERESTS = [
  "历史文化",
  "自然风光",
  "城市漫步",
  "地道美食",
  "博物馆",
  "摄影出片",
  "亲子游乐",
  "夜生活",
  "购物",
  "小众秘境",
] as const;

export const clockSchema = z.string().regex(/^\d{2}:\d{2}$/, "时间格式无效");

/** 用户在首页提交的规划需求 */
export const tripRequestSchema = z.object({
  city: z.string().trim().min(1, "请填写目的地").max(20, "目的地过长"),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式无效"),
  days: z.number().int().min(1, "至少 1 天").max(7, "单次最多规划 7 天"),
  travelers: z.number().int().min(1).max(20),
  travelerType: travelerSchema,
  budgetPerPerson: z.number().int().min(0).max(200_000).nullable(),
  pace: paceSchema,
  interests: z.array(z.enum(INTERESTS)).max(6),
  mustSee: z.string().trim().max(200),
  foodPreference: z.string().trim().max(200),
  notes: z.string().trim().max(500),
  accessibility: z.boolean(),
  /** 第一天抵达时间（到站/落地），null 表示不限 */
  arrivalTime: clockSchema.nullable().default(null),
  /** 最后一天离开时间（发车/起飞），null 表示不限 */
  departureTime: clockSchema.nullable().default(null),
  /** 已订酒店名称，留空由 Agent 推荐住宿区域 */
  hotelName: z.string().trim().max(60).default(""),
  /** 出发城市，填写后 Agent 推荐往返车次 */
  origin: z.string().trim().max(20).default(""),
});
export type TripRequest = z.infer<typeof tripRequestSchema>;

/** 地点：只来自高德检索结果，模型不能自造 */
export const placeSchema = z.object({
  id: z.string(),
  name: z.string(),
  address: z.string().nullable(),
  location: coordinateSchema,
  type: z.string().nullable(),
  rating: z.number().nullable(),
  /** 高德返回的人均消费（元），不是门票 */
  avgCost: z.number().nullable(),
  openTime: z.string().nullable(),
  photos: z.array(z.string()).max(3),
  citycode: z.string().nullable(),
  adcode: z.string().nullable(),
  /** 由高德 typecode 归类，用于替换候选与地图样式 */
  category: z.enum(["sight", "food", "hotel", "other"]).default("other"),
  /** 高德收录的招牌菜（仅餐厅） */
  signatureDishes: z.array(z.string()).max(8).default([]),
  /** 高德收录的联系电话（第一个） */
  tel: z.string().nullable().default(null),
});
export type Place = z.infer<typeof placeSchema>;

export const stopKindSchema = z.enum(["sight", "meal", "rest"]);
export type StopKind = z.infer<typeof stopKindSchema>;

export const stopSchema = z.object({
  kind: stopKindSchema,
  mealType: z.enum(["breakfast", "lunch", "dinner", "snack"]).nullable(),
  place: placeSchema,
  /** 计算后的到达时刻 HH:mm（确定性排程器给出） */
  start: z.string(),
  end: z.string(),
  durationMin: z.number().int(),
  title: z.string(),
  description: z.string(),
  highlights: z.array(z.string()),
  tips: z.array(z.string()),
  /** 每人门票估算（元）；null 代表未知，不等于免费 */
  ticketCny: z.number().nullable(),
  /** 每人餐费估算（元） */
  mealCny: z.number().nullable(),
  dishes: z.array(z.string()),
  citations: z.array(z.string()),
  warnings: z.array(z.string()),
  /** 门票价格的联网核对来源；null 表示 AI 估算 */
  ticketSource: z
    .object({
      url: z.string(),
      title: z.string(),
      official: z.boolean(),
      checkedAt: z.string(),
    })
    .nullable()
    .default(null),
  /** 用户锁定：AI 调整时必须保留 */
  locked: z.boolean().default(false),
  /** 用户手动替换/修改过 */
  userEdited: z.boolean().default(false),
});
export type Stop = z.infer<typeof stopSchema>;

export const legModeSchema = z.enum(["walking", "transit", "taxi"]);
export type LegMode = z.infer<typeof legModeSchema>;

export const legSchema = z.object({
  mode: legModeSchema,
  minutes: z.number().nullable(),
  meters: z.number().nullable(),
  /** 每人费用（元）；打车按车均摊 */
  costCny: z.number().nullable(),
  summary: z.string(),
  /** 真实路线折线，缺失时为空数组，前端不补直线 */
  path: z.array(coordinateSchema),
  alternative: z.string().nullable(),
});
export type Leg = z.infer<typeof legSchema>;

export const weatherSchema = z.object({
  date: z.string(),
  dayWeather: z.string(),
  nightWeather: z.string(),
  high: z.number(),
  low: z.number(),
  wind: z.string(),
});
export type Weather = z.infer<typeof weatherSchema>;

export const daySchema = z.object({
  day: z.number().int(),
  date: z.string(),
  theme: z.string(),
  summary: z.string(),
  stops: z.array(stopSchema),
  /** legs[i] 连接 stops[i] 与 stops[i+1] */
  legs: z.array(legSchema),
  /** 从酒店到第一站 / 从最后一站回酒店（单日行程或最后一天为 null） */
  startLeg: legSchema.nullable().default(null),
  endLeg: legSchema.nullable().default(null),
  weather: weatherSchema.nullable(),
  warnings: z.array(z.string()),
});
export type Day = z.infer<typeof daySchema>;

export const citationSchema = z.object({
  id: z.string(),
  title: z.string(),
  source: z.string(),
  excerpt: z.string(),
});
export type Citation = z.infer<typeof citationSchema>;

export const budgetSchema = z.object({
  tickets: z.number().nullable(),
  meals: z.number().nullable(),
  transport: z.number().nullable(),
  hotel: z.number().nullable(),
  /** 往返火车（每人，按二等座或最低价） */
  intercity: z.number().nullable().default(null),
  /** 每人合计（只计已知项） */
  total: z.number(),
  unknownItems: z.array(z.string()),
  hotelNote: z.string(),
});
export type Budget = z.infer<typeof budgetSchema>;

/** 铁路车次（来自高德跨城公交规划：时刻表与票价，不含余票） */
export const trainSchema = z.object({
  trip: z.string(),
  type: z.string(),
  date: z.string(),
  from: z.string(),
  to: z.string(),
  depart: z.string(),
  arrive: z.string(),
  arriveNextDay: z.boolean(),
  minutes: z.number(),
  /** 各席别票价：同一席别可能有多档（不同站点组合），price 为最低、maxPrice 为最高 */
  seats: z.array(
    z.object({ name: z.string(), price: z.number(), maxPrice: z.number().optional() }),
  ),
  /** 含两端市内接驳的门到门耗时（分钟） */
  doorToDoorMinutes: z.number().nullable(),
});
export type Train = z.infer<typeof trainSchema>;

export const stationSchema = z.object({
  name: z.string(),
  location: coordinateSchema,
  citycode: z.string().nullable().default(null),
});
export type Station = z.infer<typeof stationSchema>;

export const intercitySchema = z.object({
  origin: z.string(),
  outbound: trainSchema.nullable(),
  inbound: trainSchema.nullable(),
  note: z.string(),
  /** 去程到达站、返程出发站在目的地城市的位置：第一天从到达站出发，最后一天前往出发站 */
  arrivalStation: stationSchema.nullable().default(null),
  departureStation: stationSchema.nullable().default(null),
});
export type Intercity = z.infer<typeof intercitySchema>;

export const hotelSchema = z.object({
  place: placeSchema,
  reason: z.string(),
  /** 每间每晚参考价（AI 估算） */
  pricePerNightCny: z.number().nullable(),
  /** 用户自己指定的酒店 */
  userProvided: z.boolean(),
});
export type Hotel = z.infer<typeof hotelSchema>;

export const tripSchema = z.object({
  title: z.string(),
  subtitle: z.string(),
  city: z.string(),
  overview: z.string(),
  days: z.array(daySchema),
  tips: z.array(z.object({ text: z.string(), citations: z.array(z.string()) })),
  packing: z.array(z.string()),
  budget: budgetSchema,
  citations: z.array(citationSchema),
  changeSummary: z.string().nullable(),
  generatedAt: z.string(),
  hotel: hotelSchema.nullable().default(null),
  intercity: intercitySchema.nullable().default(null),
  /** Agent 检索到但未采用的地点，供手动替换 */
  candidates: z.array(placeSchema).max(80).default([]),
});
export type Trip = z.infer<typeof tripSchema>;

/** Agent 流式事件（NDJSON 每行一条） */
export type AgentEvent =
  | { type: "status"; message: string }
  | { type: "thought"; delta: string }
  | { type: "tool_call"; id: string; name: string; label: string }
  | { type: "tool_result"; id: string; ok: boolean; summary: string; places?: Place[] }
  | { type: "day"; day: Day }
  | { type: "trip"; trip: Trip }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

export const agentInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("plan"), request: tripRequestSchema }),
  z.object({
    mode: z.literal("revise"),
    request: tripRequestSchema,
    trip: tripSchema,
    instruction: z.string().trim().min(2, "请描述想怎么调整").max(300, "调整说明过长"),
  }),
]);
export type AgentInput = z.infer<typeof agentInputSchema>;

/** 手动编辑某一天后的重新排程请求（不调用模型） */
export const rescheduleInputSchema = z.object({
  request: tripRequestSchema,
  trip: tripSchema,
  day: z.number().int().min(1),
  stops: z.array(stopSchema).min(1).max(12),
  label: z.string().trim().min(1).max(80),
});
export type RescheduleInput = z.infer<typeof rescheduleInputSchema>;

/** 行前问答 */
export const askInputSchema = z.object({
  request: tripRequestSchema,
  trip: tripSchema,
  question: z.string().trim().min(2, "问题太短了").max(300, "问题请控制在 300 字以内"),
  history: z
    .array(
      z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(2000) }),
    )
    .max(8)
    .default([]),
});
export type AskInput = z.infer<typeof askInputSchema>;

export interface AskSource {
  id: string;
  title: string;
  /** 联网来源才有链接 */
  url?: string;
  official?: boolean;
}

export type AskEvent =
  | { type: "tool_call"; id: string; name: string; label: string }
  | { type: "tool_result"; id: string; ok: boolean; summary: string }
  | { type: "answer"; delta: string }
  /** 本轮文字只是调用工具前的说明，不是最终回答 */
  | { type: "answer_discard" }
  | { type: "sources"; items: AskSource[]; live: boolean }
  | { type: "error"; code: string; message: string }
  | { type: "done" };

/** 拍照识景：视觉模型对照片的理解结果 */
export const photoInsightSchema = z.object({
  scene: z.string().max(160).catch(""),
  place: z.string().max(40).nullable().catch(null),
  city: z.string().max(20).nullable().catch(null),
  confidence: z.enum(["high", "medium", "low"]).catch("low"),
  styles: z.array(z.string().max(12)).max(5).catch([]),
  interests: z
    .array(z.string())
    .catch([])
    .transform((items) =>
      items
        .filter((item): item is (typeof INTERESTS)[number] =>
          (INTERESTS as readonly string[]).includes(item),
        )
        .slice(0, 4),
    ),
  suggestions: z
    .array(z.object({ city: z.string().max(20), reason: z.string().max(80) }))
    .max(3)
    .catch([]),
  note: z.string().max(120).catch(""),
});
export type PhotoInsight = z.infer<typeof photoInsightSchema>;
