import { z } from "zod";
import type { ManualIntercitySegment } from "@/domain/intercity";
import { intercityTimeZone } from "@/domain/intercity";
import { coordinateSchema, walkingSchema } from "./contracts";

const station = z.strictObject({
  id: z.string().regex(/^station:[a-zA-Z0-9-]{1,60}$/),
  name: z.string().trim().min(1).max(80),
  location: coordinateSchema.nullable(),
});
const minuteTimestamp = z.iso.datetime().refine((value) => {
  const epoch = Date.parse(value);
  return (
    Number.isFinite(epoch) &&
    new Date(epoch).toISOString() === value &&
    value.endsWith(":00.000Z")
  );
}, "班次须使用完整日期与分钟精度时间。");

export const manualIntercitySchema: z.ZodType<ManualIntercitySegment> = z
  .strictObject({
    id: z.string().regex(/^intercity:[a-zA-Z0-9-]{1,60}$/),
    role: z.enum(["arrival", "return"]),
    mode: z.enum(["rail", "flight"]),
    serviceNumber: z
      .string()
      .trim()
      .min(1)
      .max(40)
      .regex(/^[a-zA-Z0-9 -]+$/)
      .nullable(),
    origin: station,
    destination: station,
    departureAt: minuteTimestamp,
    arrivalAt: minuteTimestamp,
    timeZone: z.literal(intercityTimeZone),
    terminalBufferMinutes: z.number().int().min(0).max(360).nullable(),
    farePerPersonFen: z.number().int().min(0).max(10_000_000).nullable(),
    source: z.strictObject({ kind: z.literal("user"), recordedAt: z.iso.datetime() }),
  })
  .refine(
    (segment) =>
      segment.origin.id !== segment.destination.id &&
      Date.parse(segment.departureAt) < Date.parse(segment.arrivalAt),
    "到达必须晚于出发，起终点不能使用相同标识。",
  );

const connection = z.strictObject({
  fromId: z.string().min(1).max(100),
  toId: z.string().min(1).max(100),
  seconds: z.number().int().min(0).max(86_400).nullable(),
  source: walkingSchema.shape.source,
});

export const intercitySegmentsSchema = z
  .array(manualIntercitySchema)
  .max(2)
  .refine(
    (segments) =>
      new Set(segments.map((segment) => segment.role)).size === segments.length &&
      new Set(segments.map((segment) => segment.id)).size === segments.length,
    "到达与返程最多各一个，且班次标识不能重复。",
  );

export const intercitySetupSchema = z.strictObject({
  segments: intercitySegmentsSchema,
  connections: z.strictObject({
    arrival: connection.nullable().optional(),
    return: connection.nullable().optional(),
  }),
});
