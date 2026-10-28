import { z } from "zod";
import { tripBriefSchema } from "./trip-brief-contracts";
import { dayActivitySchema, activityLegSchema } from "./meal-contracts";
import type { Itinerary, ItineraryOutline } from "@/domain/itinerary";
import { briefDays, briefBudget } from "@/domain/trip-brief";
import type { ItineraryChange } from "@/domain/itinerary-editing";
import type { ItineraryRouteResolution } from "@/domain/itinerary-moves";
import { budgetEstimateSchema, coordinateSchema, walkingSchema } from "./contracts";
import { venueRulesSchema } from "./venue-contracts";

export const itineraryExpensesSchema = budgetEstimateSchema.pick({ items: true });
const activityId = z.string().regex(/^activity:[a-zA-Z0-9-]{1,850}$/);
export const itineraryChangeSchema: z.ZodType<ItineraryChange> = z.discriminatedUnion(
  "kind",
  [
    z.strictObject({
      kind: z.literal("expenses"),
      expenses: itineraryExpensesSchema,
      acknowledgeOver: z.boolean(),
    }),
    z.strictObject({
      kind: z.literal("duration"),
      activityId,
      stayMinutes: z.number().int().min(15).max(240),
    }),
    z.strictObject({ kind: z.literal("time_lock"), activityId, locked: z.boolean() }),
    z.strictObject({ kind: z.literal("position_lock"), activityId, locked: z.boolean() }),
    z.strictObject({
      kind: z.literal("venue_rules"),
      activityId,
      rules: venueRulesSchema.nullable(),
      reservationRelease: z
        .strictObject({
          activityId,
          beforeKey: z.string().min(1).max(4096),
          afterKey: z.string().min(1).max(4096),
        })
        .nullable(),
    }),
    z.strictObject({
      kind: z.literal("move"),
      activityId,
      toDay: z.number().int().min(0).max(13),
      toIndex: z.number().int().min(0).max(7),
    }),
  ],
);

export const itineraryRouteResolutionSchema: z.ZodType<ItineraryRouteResolution> =
  z.strictObject({
    fromActivityId: activityId,
    toActivityId: activityId,
    origin: coordinateSchema,
    destination: coordinateSchema,
    route: walkingSchema
      .strict()
      .extend({ segments: z.array(z.array(coordinateSchema).max(10_000)).max(100) }),
  });

const guideText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (text) => !/(?:https?:\/\/|www\.|data:|javascript:)/i.test(text),
      "游玩建议不能指定外部网址或图片。",
    );
export const itineraryGuideSchema = z.strictObject({
  experience: guideText(240),
  highlights: z.array(guideText(60)).min(1).max(3),
  tips: z.array(guideText(100)).min(1).max(3),
  checkBeforeGo: z.array(guideText(80)).min(1).max(3),
});
const choice = z.strictObject({
  placeId: z.string().min(1).max(100),
  reason: z.string().trim().min(1).max(160),
  stayMinutes: z.number().int().min(15).max(180),
});
const food = choice.extend({ dish: z.string().trim().min(1).max(80) });
export const itineraryOutlineSchema: z.ZodType<ItineraryOutline> = z
  .strictObject({
    guides: z
      .array(
        itineraryGuideSchema.extend({
          placeId: z.string().min(1).max(100),
        }),
      )
      .max(84)
      .optional(),
    title: z.string().trim().min(1).max(60),
    summary: z.string().trim().min(1).max(400),
    days: z
      .array(
        z.strictObject({
          theme: z.string().trim().min(1).max(80),
          visits: z.array(choice).min(1).max(3),
          breakfast: food,
          lunch: food,
          dinner: food,
        }),
      )
      .min(1)
      .max(14),
  })
  .superRefine((outline, context) => {
    const selected = new Set(
      outline.days.flatMap((day) =>
        [...day.visits, day.breakfast, day.lunch, day.dinner].map(
          (choice) => choice.placeId,
        ),
      ),
    );
    const ids = outline.guides?.map((guide) => guide.placeId) ?? [];
    if (new Set(ids).size !== ids.length || ids.some((id) => !selected.has(id))) {
      context.addIssue({ code: "custom", message: "游玩建议必须唯一关联已选择的地点。" });
    }
  });
const schedule = z.strictObject({
  date: z.iso.date(),
  timeZone: z.literal("Asia/Shanghai"),
  items: z
    .array(
      z.strictObject({
        activity: dayActivitySchema,
        startMinute: z.number().int().nullable(),
        endMinute: z.number().int().nullable(),
        startAt: z.iso.datetime().nullable(),
        endAt: z.iso.datetime().nullable(),
      }),
    )
    .max(8),
  legs: z.array(activityLegSchema).max(7),
  issues: z
    .array(
      z.strictObject({
        activityId: z.string().nullable(),
        severity: z.enum(["unknown", "conflict"]),
        code: z.string(),
        message: z.string(),
      }),
    )
    .max(100),
  status: z.enum(["unverified", "infeasible"]),
  notices: z.array(z.string()).max(12),
});
export const itinerarySchema: z.ZodType<Itinerary> = z
  .strictObject({
    brief: tripBriefSchema,
    expenses: itineraryExpensesSchema.optional(),
    title: z.string().min(1).max(60),
    summary: z.string().min(1).max(400),
    days: z
      .array(
        z.strictObject({
          date: z.iso.date(),
          theme: z.string().min(1).max(80),
          schedule: schedule.nullable(),
          recommendations: z
            .array(
              z.strictObject({
                activityId: z.string(),
                reason: z.string().max(160),
                dish: z.string().max(80).nullable(),
                guide: itineraryGuideSchema.optional(),
              }),
            )
            .max(8),
          notices: z.array(z.string()).max(15),
        }),
      )
      .min(1)
      .max(14),
    constraints: z
      .array(
        z.strictObject({
          label: z.string(),
          status: z.enum(["scheduled", "unverified", "conflict"]),
          message: z.string(),
        }),
      )
      .max(100),
    allocation: z
      .array(
        z.strictObject({
          category: z.enum(["intercity", "local", "lodging", "meals", "tickets"]),
          targetFen: z.number().int().min(0).max(200_000_000),
        }),
      )
      .length(5),
    model: z.string().min(1).max(96),
    generatedAt: z.iso.datetime(),
    fixture: z.boolean(),
    status: z.enum(["unverified", "infeasible"]),
    notices: z.array(z.string()).max(20),
  })
  .superRefine((plan, context) => {
    const dates = briefDays(plan.brief).map((day) => day.date);
    if (
      plan.days.length !== dates.length ||
      plan.days.some(
        (day, index) =>
          day.date !== dates[index] ||
          (day.schedule !== null && day.schedule.date !== day.date),
      )
    ) {
      context.addIssue({ code: "custom", message: "完整行程日期与旅行需求不一致。" });
    }
    if (
      new Set(plan.allocation.map((item) => item.category)).size !== 5 ||
      plan.allocation.reduce((sum, item) => sum + item.targetFen, 0) !==
        briefBudget(plan.brief).totalFen
    ) {
      context.addIssue({ code: "custom", message: "费用目标分配与全体预算不一致。" });
    }
    const items = plan.days.flatMap((day) => day.schedule?.items ?? []);
    if (new Set(items.map((item) => item.activity.id)).size !== items.length) {
      context.addIssue({
        code: "custom",
        message: "完整行程的活动实例标识必须全程唯一。",
      });
    }
    if (
      !plan.fixture &&
      items.some((item) => item.activity.place.source.kind === "fixture")
    ) {
      context.addIssue({ code: "custom", message: "测试来源不能冒充真实规划。" });
    }
    if (
      plan.status !== "infeasible" &&
      (plan.constraints.some((item) => item.status === "conflict") ||
        plan.days.some((day) => day.schedule?.status === "infeasible"))
    ) {
      context.addIssue({ code: "custom", message: "不可隐藏已有行程冲突。" });
    }
    for (const day of plan.days) {
      if (!day.schedule) {
        continue;
      }
      const schedule = day.schedule;
      if (
        new Set(schedule.items.map((item) => item.activity.id)).size !==
          schedule.items.length ||
        schedule.legs.length !== Math.max(0, schedule.items.length - 1) ||
        schedule.legs.some(
          (leg, index) =>
            leg.fromActivityId !== schedule.items[index].activity.id ||
            leg.toActivityId !== schedule.items[index + 1].activity.id,
        )
      ) {
        context.addIssue({ code: "custom", message: "活动实例与有向交通段不一致。" });
      }
      if (
        new Set(day.recommendations.map((item) => item.activityId)).size !==
          day.recommendations.length ||
        day.recommendations.some(
          (recommendation) =>
            !schedule.items.some(
              (item) => item.activity.id === recommendation.activityId,
            ),
        )
      ) {
        context.addIssue({ code: "custom", message: "图文说明与活动实例不一致。" });
      }
    }
  });
const planningStageSchema = z.enum(["places", "model", "routes"]);
export const planningFailureSchema = z.object({
  message: z.string().trim().min(1).max(200),
  code: z.string().regex(/^[a-z0-9_]{1,80}$/),
  stage: planningStageSchema.optional(),
  retryAfterSeconds: z.number().int().min(1).max(3600).optional(),
});
export const itineraryEventSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("progress"),
    message: z.string().max(120),
    stage: planningStageSchema.optional(),
  }),
  z.strictObject({ type: z.literal("result"), plan: itinerarySchema }),
  z.strictObject({
    type: z.literal("error"),
    ...planningFailureSchema.shape,
  }),
]);
