import type { Place, WalkingRoute } from "./models";
import { atShanghaiMinute } from "./intercity";

// Day-relative minutes. End is exclusive; an activity may finish exactly at closing.
export type MinuteWindow = { startMinute: number; endMinute: number };
export type VenueRules = {
  date: string;
  openingWindows: MinuteWindow[] | null;
  lastEntryMinute: number | null;
  reservation: {
    state: "unknown" | "not_required" | "required_unconfirmed" | "confirmed";
    entryWindow: MinuteWindow | null;
  };
  source: { kind: "user"; recordedAt: string };
};
export type DayActivity = {
  id: string;
  kind: "visit" | "breakfast" | "lunch" | "dinner";
  place: Place;
  stayMinutes: number;
  window: MinuteWindow | null;
  fixedStartMinute: number | null;
  positionLocked?: boolean;
  rules: VenueRules | null;
  meal: {
    perPersonFen: number | null;
    dietaryCheck: "unknown" | "user_checked" | "user_conflict";
    source: { kind: "user" | "unverified"; recordedAt: string };
  } | null;
};
export type ActivityLeg = {
  fromActivityId: string;
  toActivityId: string;
  route: WalkingRoute | null;
};
export type MealDayInput = {
  date: string;
  timeZone: "Asia/Shanghai";
  startMinute: number;
  endMinute: number;
  bufferMinutes: number;
  activities: DayActivity[];
  legs: ActivityLeg[];
};
export type PlanningIssue = {
  activityId: string | null;
  severity: "unknown" | "conflict";
  code: string;
  message: string;
};
export type ScheduledActivity = {
  activity: DayActivity;
  startMinute: number | null;
  endMinute: number | null;
  startAt: string | null;
  endAt: string | null;
};
export type MealDayPlan = {
  date: string;
  timeZone: "Asia/Shanghai";
  items: ScheduledActivity[];
  legs: ActivityLeg[];
  issues: PlanningIssue[];
  status: "unverified" | "infeasible";
  notices: string[];
};

type StartRange = { earliest: number; latest: number };

function continuousOpening(windows: MinuteWindow[]): MinuteWindow[] {
  const result: MinuteWindow[] = [];
  for (const window of windows.toSorted(
    (left, right) => left.startMinute - right.startMinute,
  )) {
    const previous = result.at(-1);
    if (previous && window.startMinute <= previous.endMinute) {
      previous.endMinute = Math.max(previous.endMinute, window.endMinute);
    } else {
      result.push({ ...window });
    }
  }
  return result;
}

// Runtime contracts must validate inputs before calling this pure, ordered scheduler.
// It never searches, picks restaurants, deletes a stop, or changes the supplied locks.
export function scheduleMealDay(input: MealDayInput): MealDayPlan {
  return scheduleDay(input, ["lunch", "dinner"]);
}
export function scheduleVisitDay(input: MealDayInput): MealDayPlan {
  if (input.activities.some((activity) => activity.kind !== "visit")) {
    throw new Error("景点日排程不能绕过正式午晚餐的数量校验。");
  }
  return scheduleDay(input, []);
}
export function scheduleAvailableDay(input: MealDayInput): MealDayPlan {
  const windows = [
    { kind: "breakfast" as const, start: 420, end: 600 },
    { kind: "lunch" as const, start: 660, end: 840 },
    { kind: "dinner" as const, start: 1020, end: 1260 },
  ];
  const required = windows
    .filter(
      (window) =>
        Math.min(input.endMinute, window.end) -
          Math.max(input.startMinute, window.start) >=
        45,
    )
    .map((window) => window.kind);
  return scheduleDay(input, required);
}
function scheduleDay(
  input: MealDayInput,
  requiredMeals: readonly ("breakfast" | "lunch" | "dinner")[],
): MealDayPlan {
  const snapshot = structuredClone(input);
  const issues: PlanningIssue[] = [];
  const legs: ActivityLeg[] = [];
  const add = (
    activityId: string | null,
    severity: PlanningIssue["severity"],
    code: string,
    message: string,
  ) => issues.push({ activityId, severity, code, message });
  for (const kind of requiredMeals) {
    const count = snapshot.activities.filter((activity) => activity.kind === kind).length;
    if (count !== 1) {
      add(
        null,
        "conflict",
        "meal_count",
        `${kind === "breakfast" ? "早餐" : kind === "lunch" ? "午餐" : "晚餐"}须安排一个正式用餐地点，不会自动删除或补入地点。`,
      );
    }
  }
  let cursor: number | null = snapshot.startMinute;
  // A mathematical lower bound, NOT a replacement estimate for unknown transport.
  let earliest = snapshot.startMinute;
  const items = snapshot.activities.map((activity, index): ScheduledActivity => {
    const id = activity.id;
    if (index > 0) {
      const previous = snapshot.activities[index - 1];
      const found = snapshot.legs.find(
        (leg) => leg.fromActivityId === previous.id && leg.toActivityId === id,
      );
      const route = found?.route ?? null;
      legs.push({ fromActivityId: previous.id, toActivityId: id, route });
      const seconds = route?.seconds;
      const knownTravel = seconds == null ? null : Math.ceil(seconds / 60);
      earliest += snapshot.bufferMinutes + (knownTravel ?? 0);
      if (knownTravel === null) {
        cursor = null;
        add(
          id,
          "unknown",
          "route_unknown",
          "相邻活动的有向交通耗时未知，后续时刻保持未知；旧端点或反向路线不复用。",
        );
      } else if (cursor !== null) {
        cursor += knownTravel + snapshot.bufferMinutes;
      }
    }
    const validRules = activity.rules?.date === snapshot.date ? activity.rules : null;
    if (activity.rules?.reservation.state === "confirmed" && !validRules) {
      add(
        id,
        "conflict",
        "reservation_date_conflict",
        "已记录预约的适用日期与活动日期冲突，不会因跨天而静默忽略原预约。",
      );
    }
    if (!validRules) {
      add(
        id,
        "unknown",
        activity.rules ? "rules_date_mismatch" : "rules_unknown",
        "营业与预约规则缺失或不适用于当天，未据此宣称开放或已预约。",
      );
    }
    const window = activity.window;
    let ranges: StartRange[] = [
      {
        earliest: window?.startMinute ?? 0,
        latest: (window?.endMinute ?? Infinity) - activity.stayMinutes,
      },
    ];
    if (validRules) {
      if (validRules.openingWindows === null) {
        add(
          id,
          "unknown",
          "opening_unknown",
          "当天营业窗口未知，营业描述不当作结构化开放保证。",
        );
      } else {
        ranges = continuousOpening(validRules.openingWindows).map((opening) => ({
          earliest: Math.max(opening.startMinute, window?.startMinute ?? 0),
          latest:
            Math.min(opening.endMinute, window?.endMinute ?? Infinity) -
            activity.stayMinutes,
        }));
      }
      const lastEntry = validRules.lastEntryMinute;
      if (lastEntry === null) {
        add(id, "unknown", "last_entry_unknown", "最晚入场时间未核实。");
      } else {
        ranges = ranges.map((range) => ({
          ...range,
          latest: Math.min(range.latest, lastEntry),
        }));
      }
      const reservation = validRules.reservation;
      if (
        reservation.state === "unknown" ||
        reservation.state === "required_unconfirmed"
      ) {
        add(
          id,
          "unknown",
          "reservation_unverified",
          "预约要求或预约状态尚未确认，不代表已预约或可入场。",
        );
      }
      if (reservation.state === "confirmed") {
        if (reservation.entryWindow === null) {
          add(
            id,
            "unknown",
            "reservation_window_unknown",
            "用户记录已预约，但入场时段未知，仍需核实。",
          );
        } else {
          const entry = reservation.entryWindow;
          ranges = ranges.map((range) => ({
            earliest: Math.max(range.earliest, entry.startMinute),
            latest: Math.min(range.latest, entry.endMinute - 1),
          }));
        }
      }
    }
    if (activity.kind !== "visit") {
      if (activity.meal?.dietaryCheck === "user_conflict") {
        add(
          id,
          "conflict",
          "dietary_conflict",
          "用户记录的饮食限制与此餐厅冲突，不会自动删去限制。",
        );
      } else if (!activity.meal || activity.meal.dietaryCheck === "unknown") {
        add(
          id,
          "unknown",
          "dietary_unknown",
          "饮食适配未知，请向商家确认；不能据此保证过敏安全。",
        );
      }
      if (activity.meal?.perPersonFen == null) {
        add(
          id,
          "unknown",
          "meal_price_unknown",
          "此餐人均费用未知，不按免费或零元计算。",
        );
      }
    }
    const fixed = activity.fixedStartMinute;
    let target: number;
    if (fixed !== null) {
      target = fixed;
      if (!ranges.some((range) => range.earliest <= fixed && fixed <= range.latest)) {
        add(
          id,
          "conflict",
          "locked_window_conflict",
          "锁定开始时间与用餐、营业或预约窗口冲突，不会自动移动锁定时间。",
        );
      }
      if (earliest > fixed) {
        add(
          id,
          "conflict",
          "locked_start_missed",
          "已知活动、交通或缓冲已晚于锁定开始时间，未知部分不会消除冲突。",
        );
      } else if (cursor === null) {
        add(
          id,
          "unknown",
          "locked_start_unverified",
          "前序交通未知，不能保证按锁定时间开始。",
        );
      }
    } else {
      const possible = ranges
        .filter((range) => Math.max(earliest, range.earliest) <= range.latest)
        .sort((left, right) => left.earliest - right.earliest);
      if (possible.length === 0) {
        target = window?.startMinute ?? earliest;
        add(
          id,
          "conflict",
          "window_unreachable",
          "已知停留、交通或缓冲与用餐、营业、最晚入场或预约窗口冲突；未知交通仍待校验。",
        );
      } else {
        target = Math.max(earliest, possible[0].earliest);
        if (cursor === null) {
          add(
            id,
            "unknown",
            "window_unverified",
            "前序交通未知，仅已知时间下界未冲突，不代表能赶上窗口。",
          );
        }
      }
    }
    earliest = Math.max(earliest, target) + activity.stayMinutes;
    if (cursor !== null) {
      cursor = Math.max(cursor, target);
    }
    const startMinute = cursor;
    const endMinute: number | null =
      startMinute === null ? null : startMinute + activity.stayMinutes;
    cursor = endMinute;
    if (earliest > snapshot.endMinute) {
      add(
        id,
        "conflict",
        "day_end_exceeded",
        "已知时间下界已超过当天结束目标，不会把未知交通当作零分钟的可行方案。",
      );
    }
    return {
      activity,
      startMinute,
      endMinute,
      startAt: atShanghaiMinute(snapshot.date, startMinute),
      endAt: atShanghaiMinute(snapshot.date, endMinute),
    };
  });
  return {
    date: snapshot.date,
    timeZone: snapshot.timeZone,
    items,
    legs,
    issues,
    status: issues.some((issue) => issue.severity === "conflict")
      ? "infeasible"
      : "unverified",
    notices: [
      "营业、预约及饮食核对为用户录入，非商家实时保证；请再次确认预约和过敏安全。",
      "地点顺序、停留和时间窗来自输入；仅按有向路线总耗时加一次独立缓冲，不生成交通或排队估算。",
      "餐费为用户人均估算，未知不按零元；明确零元也不代表免费或实时报价。",
    ],
  };
}
