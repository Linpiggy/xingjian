import { z } from "zod";

export const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const sourceFields = {
  queriedAt: z.iso.datetime(),
  coordinateSystem: z.literal("GCJ-02"),
};
const sourceSchema = z.discriminatedUnion("kind", [
  z.object({ ...sourceFields, kind: z.literal("provider"), provider: z.literal("amap") }),
  z.object({ ...sourceFields, kind: z.literal("fixture"), provider: z.literal("amap") }),
  z.object({ ...sourceFields, kind: z.literal("user"), provider: z.literal("user") }),
]);
export const selectionSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("amap"),
    poiId: z
      .string()
      .min(1)
      .max(80)
      .regex(/^[A-Za-z0-9_-]+$/),
    keyword: z.string().trim().min(1).max(60),
  }),
  z.strictObject({
    kind: z.literal("user"),
    id: z.string().regex(/^user:[a-zA-Z0-9-]{1,60}$/),
    name: z.string().trim().min(1).max(60),
    location: coordinateSchema,
  }),
]);
export const placeSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  address: z.string().nullable(),
  citycode: z.string().nullable(),
  location: coordinateSchema,
  openingHours: z.string().nullable(),
  source: sourceSchema,
});
export const walkingSchema = z.object({
  mode: z.literal("walking"),
  meters: z.number().nonnegative().nullable(),
  seconds: z.number().nonnegative().nullable(),
  segments: z.array(z.array(coordinateSchema)),
  source: sourceSchema,
});
export const tripInputSchema = z
  .strictObject({
    city: z.string().trim().min(1, "请输入目的地城市").max(40),
    startDate: z.iso.date({ error: "请输入有效的出行日期" }),
    dayCount: z.union([z.literal(2), z.literal(3)], {
      error: "旅行天数仅支持 2 或 3 天",
    }),
    travelers: z
      .number({ error: "请填写同行人数" })
      .int({ error: "同行人数须为整数" })
      .min(1, "至少一位旅客")
      .max(8, "本轮最多支持八位旅客"),
    budgetPerPersonFen: z
      .number({ error: "请填写每人预算" })
      .int({ error: "金额最多两位小数" })
      .min(0, "预算不能为负")
      .max(10_000_000, "每人预算不能超过十万元"),
    keywords: z
      .array(z.string().trim().min(1).max(60))
      .min(2, "请至少选择两个地点")
      .max(6, "本轮最多支持六个地点"),
    selections: z.array(selectionSchema).min(2).max(6).optional(),
    stayMinutes: z
      .number({ error: "请填写停留时间" })
      .int({ error: "停留分钟数须为整数" })
      .min(15, "停留至少 15 分钟")
      .max(240, "停留最多 240 分钟"),
    bufferMinutes: z
      .number({ error: "请填写缓冲时间" })
      .int({ error: "缓冲分钟数须为整数" })
      .min(0, "缓冲不能为负")
      .max(60, "缓冲最多 60 分钟"),
  })
  .superRefine((input, ctx) => {
    if (input.selections && input.selections.length !== input.keywords.length) {
      ctx.addIssue({
        code: "custom",
        path: ["selections"],
        message: "地点选择与清单不一致",
      });
    }
    if (!input.selections && new Set(input.keywords).size !== input.keywords.length) {
      ctx.addIssue({ code: "custom", path: ["keywords"], message: "地点名称不能重复" });
    }
    if (input.keywords.length < input.dayCount) {
      ctx.addIssue({
        code: "custom",
        path: ["keywords"],
        message: "地点数量不能少于旅行天数",
      });
    }
  });
export const routeInputSchema = z.strictObject({
  origin: coordinateSchema,
  destination: coordinateSchema,
});
export const searchInputSchema = z.object({
  city: z.string().trim().min(1).max(40),
  keyword: z.string().trim().min(1).max(60),
});
const legSchema = z.object({
  fromId: z.string(),
  toId: z.string(),
  route: walkingSchema.nullable(),
  error: z.string().nullable(),
});
const daySchema = z.object({
  date: z.iso.date(),
  items: z.array(
    z.object({
      place: placeSchema,
      startMinute: z.number().nullable(),
      endMinute: z.number().nullable(),
      stayMinutes: z.number(),
    }),
  ),
  legs: z.array(legSchema),
  issues: z.array(z.string()),
});
export const draftSchema = z.object({
  input: tripInputSchema,
  days: z.array(daySchema),
  status: z.enum(["unverified", "infeasible"]),
  notices: z.array(z.string()),
});
export const planResponseSchema = z.object({ draft: draftSchema });
export const placesResponseSchema = z.object({ places: z.array(placeSchema).max(5) });
export const candidateSchema = z.object({
  place: placeSchema,
  selection: selectionSchema,
});
export const interestSchema = z.enum(["自然风光", "博物馆", "城市漫步", "当地美食"]);
export const recommendationInputSchema = z.strictObject({
  city: z.string().trim().min(1, "请先填写目的地城市").max(40),
  dayCount: z.union([z.literal(2), z.literal(3)]),
  budgetPerPersonFen: z.number().int().min(0).max(10_000_000),
  interests: z.array(interestSchema).min(1, "至少选择一项兴趣").max(3),
});
export const aiChoicesSchema = z.strictObject({
  recommendations: z
    .array(
      z.strictObject({
        placeId: z.string().min(1).max(80),
        reason: z.string().trim().min(1).max(160),
      }),
    )
    .min(2)
    .max(6),
});
export const recommendationsResponseSchema = z.object({
  recommendations: z
    .array(candidateSchema.extend({ reason: z.string().max(160) }))
    .max(6),
  model: z.string(),
  queriedAt: z.iso.datetime(),
});
