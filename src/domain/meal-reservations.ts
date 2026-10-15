import type { MealEntry, MealSetup } from "./meals";

// Canonical comparison keys, not signatures, permissions or merchant cancellation.
export type MealReservationRelease = {
  activityId: string;
  beforeKey: string;
  afterKey: string;
};
function reservationKey(date: string, entry: MealEntry): string {
  const window = entry.rules?.reservation.entryWindow;
  return JSON.stringify([
    date,
    entry.id,
    entry.kind,
    entry.place.id,
    entry.place.location,
    entry.rules?.date ?? null,
    entry.rules?.reservation.state ?? "unknown",
    window ? [window.startMinute, window.endMinute] : null,
    entry.fixedStartMinute,
  ]);
}
export function mealReservationReleases(
  before: MealSetup,
  after: MealSetup,
): MealReservationRelease[] {
  const next = after.days.flatMap((day) =>
    day.entries.map((entry) => ({ date: day.date, entry })),
  );
  const releases: MealReservationRelease[] = [];
  for (const day of before.days) {
    for (const entry of day.entries) {
      if (entry.rules?.reservation.state !== "confirmed") {
        continue;
      }
      const matches = next.filter((item) => item.entry.id === entry.id);
      if (matches.length > 1) {
        throw new Error("预约活动标识重复，不能判断需要核对的变更。");
      }
      const beforeKey = reservationKey(day.date, entry);
      const afterKey = matches.length
        ? reservationKey(matches[0].date, matches[0].entry)
        : "null";
      if (beforeKey !== afterKey) {
        releases.push({ activityId: entry.id, beforeKey, afterKey });
      }
    }
  }
  return releases;
}
export function reservationReleaseConflicts(
  before: MealSetup,
  after: MealSetup,
  acknowledgements: MealReservationRelease[],
): string[] {
  const required = mealReservationReleases(before, after);
  const invalid = () => new Error("预约变更核对与当前修改不一致，请重新预览并明确核对。");
  if (!Array.isArray(acknowledgements) || acknowledgements.length > 6) {
    throw invalid();
  }
  const seen = new Set<string>();
  for (const acknowledgement of acknowledgements) {
    if (
      !acknowledgement ||
      typeof acknowledgement !== "object" ||
      Object.keys(acknowledgement).length !== 3 ||
      seen.has(acknowledgement.activityId)
    ) {
      throw invalid();
    }
    const match = required.find((item) => item.activityId === acknowledgement.activityId);
    if (
      !match ||
      acknowledgement.beforeKey !== match.beforeKey ||
      acknowledgement.afterKey !== match.afterKey
    ) {
      throw invalid();
    }
    seen.add(acknowledgement.activityId);
  }
  return required
    .filter((item) => !seen.has(item.activityId))
    .map((item) => {
      const day = before.days.find((value) =>
        value.entries.some((entry) => entry.id === item.activityId),
      )!;
      const entry = day.entries.find((value) => value.id === item.activityId)!;
      return `${day.date} ${entry.kind === "lunch" ? "午餐" : "晚餐"}“${entry.place.name}”的已记录预约将变更或移除，请针对当前修改明确核对；此操作不代为取消商家预约。`;
    });
}
