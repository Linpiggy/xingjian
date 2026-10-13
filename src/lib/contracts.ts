import { z } from "zod";

export const coordinateSchema = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
]);
const sourceSchema = z.object({
  kind: z.enum(["provider", "fixture"]),
  provider: z.literal("amap"),
  queriedAt: z.iso.datetime(),
  coordinateSystem: z.literal("GCJ-02"),
});
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
      .min(2, "请至少填写两个地点")
      .max(6, "本轮最多支持六个地点"),
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
    if (new Set(input.keywords).size !== input.keywords.length) {
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
