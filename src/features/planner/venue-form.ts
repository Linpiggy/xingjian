import type { Place } from "@/domain/models";
import type { VenueRules } from "@/domain/meal-planning";
import {
  atShanghaiMinute,
  parseShanghaiLocalDateTime,
  toShanghaiLocalDateTime,
} from "@/domain/intercity";
import { venueRulesSchema } from "@/lib/meal-contracts";

export type VenueFields = {
  forPlace: string;
  enabled: boolean;
  date: string;
  opening: "unknown" | "closed" | "windows";
  windows: { start: string; end: string }[];
  lastEntry: string;
  reservation: VenueRules["reservation"]["state"];
  entryStart: string;
  entryEnd: string;
  releaseConfirmed: boolean;
};
export const venueIdentity = (place: Place | null) =>
  place ? JSON.stringify([place.id, ...place.location]) : "";
function local(date: string, minute: number | null): string {
  if (minute === null) {
    return "";
  }
  const at = atShanghaiMinute(date, minute);
  if (at === null) {
    throw new Error("营业预约记录的日期时间无效。");
  }
  return toShanghaiLocalDateTime(at);
}
export function initialVenueFields(
  rules: VenueRules | null,
  date: string,
  place: Place | null,
): VenueFields {
  const ruleDate = rules?.date ?? date;
  return {
    forPlace: venueIdentity(place),
    enabled: rules !== null,
    date: ruleDate,
    opening:
      rules?.openingWindows == null
        ? "unknown"
        : rules.openingWindows.length
          ? "windows"
          : "closed",
    windows:
      rules?.openingWindows?.map((window) => ({
        start: local(ruleDate, window.startMinute),
        end: local(ruleDate, window.endMinute),
      })) ?? [],
    lastEntry: local(ruleDate, rules?.lastEntryMinute ?? null),
    reservation: rules?.reservation.state ?? "unknown",
    entryStart: local(ruleDate, rules?.reservation.entryWindow?.startMinute ?? null),
    entryEnd: local(ruleDate, rules?.reservation.entryWindow?.endMinute ?? null),
    releaseConfirmed: false,
  };
}
function minute(date: string, value: string): number {
  try {
    return (
      (Date.parse(parseShanghaiLocalDateTime(value)) -
        Date.parse(parseShanghaiLocalDateTime(`${date}T00:00`))) /
      60_000
    );
  } catch {
    throw new Error("请填写有效的营业／预约上海日期时间。");
  }
}
export function buildVenueRules(
  fields: VenueFields,
  place: Place,
  previous: VenueRules | null,
  recordedAt: string,
): VenueRules | null {
  if (!fields.enabled || fields.forPlace !== venueIdentity(place)) {
    return null;
  }
  if (fields.opening === "windows" && fields.windows.length === 0) {
    throw new Error(
      "已知营业时段至少填写一段；未知或当天闭店请明确选择，不能用空时段代替。",
    );
  }
  if (
    fields.reservation === "confirmed" &&
    Boolean(fields.entryStart) !== Boolean(fields.entryEnd)
  ) {
    throw new Error("预约入场窗口须同时填写开始与结束，或均留空表示窗口未知。");
  }
  const rules = venueRulesSchema.parse({
    date: fields.date,
    openingWindows:
      fields.opening === "unknown"
        ? null
        : fields.opening === "closed"
          ? []
          : fields.windows.map((window) => ({
              startMinute: minute(fields.date, window.start),
              endMinute: minute(fields.date, window.end),
            })),
    lastEntryMinute: fields.lastEntry ? minute(fields.date, fields.lastEntry) : null,
    reservation: {
      state: fields.reservation,
      entryWindow:
        fields.reservation === "confirmed" && fields.entryStart && fields.entryEnd
          ? {
              startMinute: minute(fields.date, fields.entryStart),
              endMinute: minute(fields.date, fields.entryEnd),
            }
          : null,
    },
    source: { kind: "user", recordedAt },
  });
  if (
    previous &&
    JSON.stringify({ ...previous, source: null }) ===
      JSON.stringify({ ...rules, source: null })
  ) {
    return structuredClone(previous);
  }
  return rules;
}
