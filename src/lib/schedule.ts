/**
 * 确定性排程器：模型只决定“去哪、待多久、为什么”，具体时刻由这里依据真实交通耗时、
 * 营业时间与用餐窗口计算，保证时间轴自洽，冲突以警告形式显式呈现而不是静默删除。
 */
import type { Leg, Pace, Place, StopKind } from "./schema";
import { parseOpenWindow, toClock, toMinutes } from "./time";

export interface ScheduleInput {
  kind: StopKind;
  mealType: "breakfast" | "lunch" | "dinner" | "snack" | null;
  place: Pick<Place, "name" | "openTime">;
  durationMin: number;
}

export interface ScheduledSlot {
  start: string;
  end: string;
  warnings: string[];
}

export const DAY_START: Record<Pace, string> = {
  relaxed: "09:30",
  balanced: "09:00",
  packed: "08:00",
};

const MEAL_WINDOWS = {
  breakfast: { from: "07:00", to: "10:00" },
  lunch: { from: "11:30", to: "13:30" },
  dinner: { from: "17:30", to: "20:00" },
} as const;

/** 每次换乘额外预留的缓冲（找入口、排队等），与高德公交方案自带的等车时间分开 */
export const TRANSFER_BUFFER_MIN = 10;
/** 交通耗时未知时的保守估算 */
export const UNKNOWN_LEG_MIN = 30;

export function scheduleDay(
  pace: Pace,
  stops: ScheduleInput[],
  legs: Pick<Leg, "minutes">[],
): { slots: ScheduledSlot[]; warnings: string[] } {
  const dayWarnings: string[] = [];
  let cursor = toMinutes(DAY_START[pace]) ?? 540;
  const slots: ScheduledSlot[] = [];

  stops.forEach((stop, index) => {
    const warnings: string[] = [];
    if (index > 0) {
      const leg = legs[index - 1];
      const travel = leg?.minutes ?? UNKNOWN_LEG_MIN;
      cursor += travel + TRANSFER_BUFFER_MIN;
    }
    let start = cursor;

    if (stop.kind === "meal" && stop.mealType && stop.mealType !== "snack") {
      const window = MEAL_WINDOWS[stop.mealType];
      const from = toMinutes(window.from) ?? start;
      const to = toMinutes(window.to) ?? start;
      if (start < from) {
        // 到早了就等开餐，等待超过 45 分钟提醒用户可以顺路逛逛
        if (from - start > 45) {
          warnings.push(`到达较早，约有 ${from - start} 分钟空闲，可在附近散步`);
        }
        start = from;
      } else if (start > to) {
        warnings.push(`用餐时间偏晚（${toClock(start)}），建议提前垫补或调整前序行程`);
      }
    }

    const window = parseOpenWindow(stop.place.openTime);
    if (window && stop.kind !== "rest") {
      if (start < window.open) {
        if (window.open - start > 30) {
          warnings.push(`${toClock(window.open)} 才开门，已顺延等待`);
        }
        start = window.open;
      }
      if (start >= window.close) {
        warnings.push(`到达时（${toClock(start)}）可能已结束营业，请调整顺序或替换`);
      } else if (start + stop.durationMin > window.close) {
        warnings.push(`闭园/打烊前仅剩 ${window.close - start} 分钟，游览可能不完整`);
      }
    }

    const end = start + stop.durationMin;
    slots.push({ start: toClock(start), end: toClock(end), warnings });
    cursor = end;
  });

  if (cursor > 22 * 60) {
    dayWarnings.push(`当天行程预计 ${toClock(cursor)} 才结束，节奏偏紧，建议删减一项`);
  }
  const unknownLegs = legs.filter((leg) => leg.minutes === null).length;
  if (unknownLegs) {
    dayWarnings.push(
      `${unknownLegs} 段交通未取得路线数据，已按 ${UNKNOWN_LEG_MIN} 分钟估算`,
    );
  }
  return { slots, warnings: dayWarnings };
}
