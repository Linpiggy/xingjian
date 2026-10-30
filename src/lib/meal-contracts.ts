import { z } from "zod";
import type { MealDayInput } from "@/domain/meal-planning";
import { placeSchema, routeSchema } from "./contracts";

import {
  minuteWindowSchema,
  venueRulesSchema,
  userFactSourceSchema,
} from "./venue-contracts";
export { minuteWindowSchema, venueRulesSchema } from "./venue-contracts";

const minute = z.number().int().min(0).max(2880);
const sourceSchema = z.discriminatedUnion("kind", [
  placeSchema.shape.source.options[0].strict(),
  placeSchema.shape.source.options[1].strict(),
  placeSchema.shape.source.options[2].strict(),
]);
const place = placeSchema.strict().extend({
  id: z.string().min(1).max(100),
  source: sourceSchema,
});
const walking = routeSchema.strict().extend({
  seconds: z.number().min(0).max(86_400).nullable(),
  segments: z
    .array(z.array(routeSchema.shape.segments.element.element).max(10_000))
    .max(100),
  source: sourceSchema,
});
const id = z.string().regex(/^activity:[a-zA-Z0-9-]{1,850}$/);
export const dayActivitySchema = z
  .strictObject({
    id,
    kind: z.enum(["visit", "breakfast", "lunch", "dinner"]),
    place,
    stayMinutes: z.number().int().min(15).max(240),
    window: minuteWindowSchema.nullable(),
    fixedStartMinute: minute.nullable(),
    positionLocked: z.boolean().optional(),
    rules: venueRulesSchema.nullable(),
    meal: z
      .strictObject({
        perPersonFen: z.number().int().min(0).max(10_000_000).nullable(),
        dietaryCheck: z.enum(["unknown", "user_checked", "user_conflict"]),
        source: z.discriminatedUnion("kind", [
          userFactSourceSchema,
          z.strictObject({ kind: z.literal("unverified"), recordedAt: z.iso.datetime() }),
        ]),
      })
      .nullable(),
  })
  .superRefine((activity, context) => {
    if (
      activity.meal?.source.kind === "unverified" &&
      (activity.meal.perPersonFen !== null || activity.meal.dietaryCheck !== "unknown")
    ) {
      context.addIssue({
        code: "custom",
        message: "自动生成餐次不能冒充人工价格记录或饮食核对。",
      });
    }
    if (activity.kind === "visit" && activity.meal !== null) {
      context.addIssue({ code: "custom", message: "景点费用不能混作餐饮人均估算。" });
    }
    if (
      activity.kind !== "visit" &&
      (activity.meal === null || activity.window === null)
    ) {
      context.addIssue({
        code: "custom",
        message: "正式餐次须有用餐时间窗和费用／饮食核对字段；未知金额仍留空。",
      });
    }
  });
export const activityLegSchema = z
  .strictObject({ fromActivityId: id, toActivityId: id, route: walking.nullable() })
  .refine(
    (value) => value.fromActivityId !== value.toActivityId,
    "接驳须连接两个不同的活动标识。",
  );

export const mealDayInputSchema: z.ZodType<MealDayInput> = z
  .strictObject({
    date: z.iso.date(),
    timeZone: z.literal("Asia/Shanghai"),
    startMinute: z.number().int().min(0).max(1439),
    endMinute: minute,
    bufferMinutes: z.number().int().min(0).max(60),
    activities: z.array(dayActivitySchema).min(1).max(8),
    legs: z.array(activityLegSchema).max(16),
  })
  .superRefine((input, context) => {
    if (input.endMinute <= input.startMinute) {
      context.addIssue({ code: "custom", message: "当天结束目标须晚于开始。" });
    }
    if (
      new Set(input.activities.map((activity) => activity.id)).size !==
      input.activities.length
    ) {
      context.addIssue({
        code: "custom",
        message: "活动标识不能重复；同一餐厅不同餐次须使用不同活动标识。",
      });
    }
    if (
      new Set(input.legs.map((item) => `${item.fromActivityId}>${item.toActivityId}`))
        .size !== input.legs.length
    ) {
      context.addIssue({ code: "custom", message: "同向接驳结果不能重复。" });
    }
  });
