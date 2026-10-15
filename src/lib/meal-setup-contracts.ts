import { z } from "zod";
import type { MealSetup } from "@/domain/meals";
import type { MealReservationRelease } from "@/domain/meal-reservations";
import { coordinateSchema } from "./contracts";
import { activityLegSchema, dayActivitySchema } from "./meal-contracts";

const entry = dayActivitySchema
  .safeExtend({
    kind: z.enum(["lunch", "dinner"]),
    window: dayActivitySchema.shape.window.unwrap(),
    meal: dayActivitySchema.shape.meal.unwrap(),
    afterPlaceId: z.string().min(1).max(100).nullable(),
  })
  .refine(
    (value) => !value.id.startsWith("activity:visit-"),
    "餐次不得使用景点活动的保留标识。",
  );

export const mealReservationReleasesSchema: z.ZodType<MealReservationRelease[]> = z
  .array(
    z.strictObject({
      activityId: dayActivitySchema.shape.id,
      beforeKey: z.string().min(1).max(4096),
      afterKey: z.string().min(1).max(4096),
    }),
  )
  .max(6)
  .refine(
    (items) => new Set(items.map((item) => item.activityId)).size === items.length,
    "预约变更核对不能重复。",
  );

export const mealSetupSchema: z.ZodType<MealSetup> = z
  .strictObject({
    days: z
      .array(
        z.strictObject({
          date: z.iso.date(),
          endMinute: z.number().int().min(541).max(2880),
          entries: z.array(entry).min(1).max(2),
        }),
      )
      .max(3),
    connections: z
      .array(
        activityLegSchema.safeExtend({
          origin: coordinateSchema,
          destination: coordinateSchema,
        }),
      )
      .max(24),
  })
  .superRefine((input, context) => {
    const dates = input.days.map((day) => day.date);
    const ids = input.days.flatMap((day) => day.entries.map((item) => item.id));
    const pairs = input.connections.map(
      (leg) => `${leg.fromActivityId}>${leg.toActivityId}`,
    );
    if (
      new Set(dates).size !== dates.length ||
      new Set(ids).size !== ids.length ||
      new Set(pairs).size !== pairs.length
    ) {
      context.addIssue({
        code: "custom",
        message: "餐次日期、活动标识或同向路线不能重复。",
      });
    }
    if (
      input.days.length === 0 &&
      input.connections.some(
        (leg) =>
          !leg.fromActivityId.startsWith("activity:visit-") ||
          !leg.toActivityId.startsWith("activity:visit-"),
      )
    ) {
      context.addIssue({
        code: "custom",
        message: "移除全部餐次时只能查询重新相邻的景点路线。",
      });
    }
  });
