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

/** 抵达后出站、去酒店放行李的预留时间 */
export const ARRIVAL_SETTLE_MIN = 60;
/** 离开前回酒店取行李并赶往车站/机场的预留时间 */
export const DEPARTURE_RESERVE_MIN = 90;

export interface DayConstraints {
  /** 从酒店到第一站的交通 */
  startLeg?: Pick<Leg, "minutes"> | null;
  /** 当天最早可开始时间（第一天抵达时间） */
  arrival?: string | null;
  /** 抵达后到可以出发的缓冲；默认按“先去酒店放行李”计 60 分钟，直接从车站出发时更短 */
  arrivalSettle?: number;
  /** 当天必须离开的时间（最后一天返程时间） */
  departure?: string | null;
  /** 最后一站前往车站的交通；已知时按“接驳耗时 + 进站缓冲”精确判断能否赶上 */
  departureLeg?: Pick<Leg, "minutes"> | null;
}

/** 到站后进站、安检、候车的缓冲 */
export const STATION_BUFFER_MIN = 30;

export function scheduleDay(
  pace: Pace,
  stops: ScheduleInput[],
  legs: Pick<Leg, "minutes">[],
  constraints: DayConstraints = {},
): { slots: ScheduledSlot[]; warnings: string[] } {
  const dayWarnings: string[] = [];
  let cursor = toMinutes(DAY_START[pace]) ?? 540;
  const arrival = constraints.arrival ? toMinutes(constraints.arrival) : null;
  if (arrival !== null) {
    cursor = Math.max(
      cursor,
      arrival + (constraints.arrivalSettle ?? ARRIVAL_SETTLE_MIN),
    );
  }
  if (constraints.startLeg) {
    cursor += (constraints.startLeg.minutes ?? UNKNOWN_LEG_MIN) + TRANSFER_BUFFER_MIN;
  }
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

  const departure = constraints.departure ? toMinutes(constraints.departure) : null;
  if (departure !== null) {
    const reserve =
      constraints.departureLeg?.minutes != null
        ? constraints.departureLeg.minutes + STATION_BUFFER_MIN
        : DEPARTURE_RESERVE_MIN;
    if (cursor > departure - reserve) {
      dayWarnings.push(
        `最后一站 ${toClock(cursor)} 结束，前往车站并进站约需 ${reserve} 分钟，可能赶不上 ${constraints.departure} 的返程车`,
      );
    }
  }
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

/**
 * 每天必须安排的正餐：第一天到得晚就不要求午餐，最后一天走得早就不要求晚餐。
 * 校验器与提示词共用这条规则，避免模型陷入“必须吃晚饭却要赶车”的矛盾。
 */
export function requiredMeals(
  day: number,
  totalDays: number,
  arrival: string | null,
  departure: string | null,
): ("lunch" | "dinner")[] {
  const meals: ("lunch" | "dinner")[] = ["lunch", "dinner"];
  const arrive = day === 1 && arrival ? toMinutes(arrival) : null;
  const leave = day === totalDays && departure ? toMinutes(departure) : null;
  return meals.filter((meal) => {
    const window = MEAL_WINDOWS[meal];
    const from = toMinutes(window.from) ?? 0;
    const to = toMinutes(window.to) ?? 0;
    if (arrive !== null && arrive + ARRIVAL_SETTLE_MIN > to) {
      return false;
    }
    if (leave !== null && leave - DEPARTURE_RESERVE_MIN < from + 45) {
      return false;
    }
    return true;
  });
}
