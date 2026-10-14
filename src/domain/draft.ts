import type { Day, Draft, Leg, Place, TripInput } from "./models";

export function addDays(date: string, offset: number): string {
  const time = new Date(`${date}T00:00:00Z`);
  time.setUTCDate(time.getUTCDate() + offset);
  return time.toISOString().slice(0, 10);
}

// Preserve user order. This is balanced grouping, not an AI recommendation or optimizer.
export function groupPlaces(places: Place[], dayCount: number): Place[][] {
  let cursor = 0;
  return Array.from({ length: dayCount }, (_, i) => {
    const size =
      Math.floor(places.length / dayCount) + (i < places.length % dayCount ? 1 : 0);
    const group = places.slice(cursor, cursor + size);
    cursor += size;
    return group;
  });
}

export function makeDay(
  date: string,
  places: Place[],
  legs: Leg[],
  stayMinutes: number,
  bufferMinutes: number,
  timing: Record<string, { stayMinutes?: number; fixedStartMinute?: number }> = {},
): Day {
  let cursor: number | null = 9 * 60;
  const issues: string[] = [];
  const items = places.map((place, i) => {
    if (i > 0) {
      const leg = legs[i - 1];
      if (leg?.route?.seconds == null) {
        cursor = null;
        issues.push("交通耗时未知，后续时间待校验。");
      } else if (cursor !== null) {
        cursor += Math.ceil(leg.route.seconds / 60) + bufferMinutes;
      }
    }
    const setting = timing[place.id];
    const fixed = setting?.fixedStartMinute;
    if (fixed !== undefined && cursor !== null && cursor <= fixed) {
      cursor = fixed;
    }
    const duration = setting?.stayMinutes ?? stayMinutes;
    const startMinute = cursor;
    const endMinute: number | null = startMinute === null ? null : startMinute + duration;
    cursor = endMinute;
    if (endMinute !== null && endMinute > 18 * 60) {
      issues.push("活动超过 18:00，请减少地点或调整停留时间。");
    }
    return { place, startMinute, endMinute, stayMinutes: duration };
  });
  return { date, items, legs, issues: [...new Set(issues)] };
}

export function makeDraft(input: TripInput, days: Day[], notices: string[]): Draft {
  return {
    input,
    days,
    notices,
    status: days.some((day) =>
      day.items.some((item) => item.endMinute !== null && item.endMinute > 18 * 60),
    )
      ? "infeasible"
      : "unverified",
  };
}

export function formatMinute(value: number | null): string {
  if (value === null) {
    return "待校验";
  }
  const day = Math.floor(value / 1440);
  return `${day ? `次日 +${day} ` : ""}${String(Math.floor(value / 60) % 24).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}
