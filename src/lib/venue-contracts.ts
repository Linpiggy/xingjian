import { z } from "zod";

const minute = z.number().int().min(0).max(2880);
export const minuteWindowSchema = z
  .strictObject({ startMinute: minute, endMinute: minute })
  .refine((window) => window.endMinute > window.startMinute, "时间窗结束须晚于开始。");
export const userFactSourceSchema = z.strictObject({
  kind: z.literal("user"),
  recordedAt: z.iso.datetime(),
});
export const venueRulesSchema = z.strictObject({
  date: z.iso.date(),
  openingWindows: z.array(minuteWindowSchema).max(8).nullable(),
  lastEntryMinute: minute.nullable(),
  reservation: z
    .strictObject({
      state: z.enum(["unknown", "not_required", "required_unconfirmed", "confirmed"]),
      entryWindow: minuteWindowSchema.nullable(),
    })
    .refine(
      (reservation) =>
        reservation.state === "confirmed" || reservation.entryWindow === null,
      "未确认预约不能附带已确认入场时段。",
    ),
  source: userFactSourceSchema,
});
