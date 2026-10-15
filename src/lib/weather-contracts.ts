import { z } from "zod";
import { coordinateSchema } from "./contracts";
import { dailyForDate } from "@/domain/weather";

const time = z.iso.datetime({ offset: true });
const date = z.iso.date();
const period = z
  .strictObject({
    startsAt: time,
    endsAt: time,
    description: z.string().min(1).max(160).nullable(),
    precipitationType: z
      .enum(["rain", "snow", "ice", "mixed", "none", "unknown"])
      .nullable(),
    probability: z.number().min(0).max(1).nullable(),
    amountMm: z.number().nonnegative().nullable(),
  })
  .refine((value) => Date.parse(value.startsAt) < Date.parse(value.endsAt));
export const dailyWeatherSchema = z
  .strictObject({
    startsAt: time,
    endsAt: time,
    minC: z.number().nullable(),
    maxC: z.number().nullable(),
    daytime: period.nullable(),
    nighttime: period.nullable(),
  })
  .refine((value) => {
    const start = Date.parse(value.startsAt);
    const end = Date.parse(value.endsAt);
    const within = (segment: z.infer<typeof period> | null, maxEnd: number) =>
      segment === null ||
      (Date.parse(segment.startsAt) >= start &&
        Date.parse(segment.startsAt) < end &&
        Date.parse(segment.endsAt) <= maxEnd &&
        Date.parse(segment.endsAt) - Date.parse(segment.startsAt) <= 12 * 3_600_000);
    return (
      start < end &&
      end - start <= 86_400_000 &&
      (value.minC === null || value.maxC === null || value.minC <= value.maxC) &&
      within(value.daytime, end) &&
      within(value.nighttime, end + 7 * 3_600_000)
    );
  });
export const weatherSourceSchema = z.strictObject({
  kind: z.enum(["provider", "fixture"]),
  provider: z.literal("qweather"),
  queriedAt: z.iso.datetime(),
  updatedAt: z.null(),
  coordinateSystem: z.literal("GCJ-02"),
  location: coordinateSchema,
  granularity: z.literal("daily"),
  attributions: z.array(z.string().min(1).max(2048)).min(1).max(10),
});
export const weatherReportSchema = z
  .strictObject({
    date,
    status: z.enum(["available", "unknown"]),
    reason: z.enum(["out_of_range", "missing_date", "partial_coverage"]).nullable(),
    day: dailyWeatherSchema.nullable(),
    source: weatherSourceSchema.nullable(),
  })
  .superRefine((report, context) => {
    if (!date.safeParse(report.date).success) {
      return;
    }
    const expected = report.source
      ? dailyForDate(report.date, report.day ? [report.day] : [], report.source)
      : null;
    const valid =
      report.reason === "out_of_range"
        ? report.status === "unknown" && report.day === null && report.source === null
        : expected !== null &&
          report.status === expected.status &&
          report.reason === expected.reason &&
          report.day === expected.day;
    if (!valid) {
      context.addIssue({ code: "custom", message: "天气状态与有效数据不一致。" });
    }
  });
export const weatherInputSchema = z.strictObject({
  date,
  location: coordinateSchema,
  coordinateSystem: z.literal("GCJ-02"),
  region: z.literal("CN-mainland"),
});
