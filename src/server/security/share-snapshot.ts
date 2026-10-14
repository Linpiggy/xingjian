import { z } from "zod";
import type { EditSnapshot } from "@/domain/editing";

const minute = z.number().int().nonnegative().nullable();
export const shareSnapshotSchema = z.strictObject({
  title: z.literal("旅行行程"),
  timeZone: z.literal("Asia/Shanghai"),
  status: z.enum(["unverified", "infeasible"]),
  fixture: z.boolean(),
  days: z
    .array(
      z.strictObject({
        date: z.iso.date(),
        issueCount: z.number().int().nonnegative(),
        items: z
          .array(
            z.strictObject({
              label: z.string().min(1).max(160),
              visibility: z.enum(["public_name", "hidden"]),
              sourceKind: z.enum(["provider", "fixture", "user"]),
              queriedAt: z.iso.datetime().nullable(),
              startMinute: minute,
              endMinute: minute,
              stayMinutes: z.number().int().min(15).max(240),
            }),
          )
          .min(1)
          .max(6),
      }),
    )
    .min(2)
    .max(3),
  notice: z.literal("时间为行程估算，开放、预约、交通与费用仍须核实。"),
});
export type ShareSnapshot = z.infer<typeof shareSnapshotSchema>;

// An explicit public-name allowlist is required. User-defined points always
// stay hidden. Do not copy city/free text, IDs, addresses, coordinates, routes,
// budget, locks, selections or credentials into a share DTO.
export function buildShareSnapshot(
  snapshot: EditSnapshot,
  publicPlaceIds: readonly string[] = [],
): ShareSnapshot {
  const approved = new Set(publicPlaceIds);
  return shareSnapshotSchema.parse({
    title: "旅行行程",
    timeZone: "Asia/Shanghai",
    status: snapshot.draft.status,
    fixture: snapshot.draft.days.some(
      (day) =>
        day.items.some((item) => item.place.source.kind === "fixture") ||
        day.legs.some((leg) => leg.route?.source.kind === "fixture"),
    ),
    days: snapshot.draft.days.map((day) => ({
      date: day.date,
      issueCount: day.issues.length,
      items: day.items.map((item, index) => {
        const visible = item.place.source.kind !== "user" && approved.has(item.place.id);
        return {
          label: visible ? item.place.name : `地点 ${index + 1}（名称未公开）`,
          visibility: visible ? "public_name" : "hidden",
          sourceKind: item.place.source.kind,
          queriedAt: visible ? item.place.source.queriedAt : null,
          startMinute: item.startMinute,
          endMinute: item.endMinute,
          stayMinutes: item.stayMinutes,
        };
      }),
    })),
    notice: "时间为行程估算，开放、预约、交通与费用仍须核实。",
  });
}
