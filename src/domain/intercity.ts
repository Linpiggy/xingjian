import type { Coordinate, Draft, Source } from "./models";

const hourMs = 3_600_000;
export const intercityTimeZone = "Asia/Shanghai";

// HTML datetime-local has no zone. Never let the host machine choose one.
export function parseShanghaiLocalDateTime(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    throw new Error("请填写完整的上海日期与时间。");
  }
  const epoch = Date.parse(`${value}:00+08:00`);
  if (
    !Number.isFinite(epoch) ||
    new Date(epoch + 8 * hourMs).toISOString().slice(0, 16) !== value
  ) {
    throw new Error("日期或时间无效，未使用此班次。");
  }
  return new Date(epoch).toISOString();
}

export function atShanghaiMinute(date: string, minute: number | null): string | null {
  const start = Date.parse(parseShanghaiLocalDateTime(`${date}T00:00`));
  if (minute === null) {
    return null;
  }
  if (
    !Number.isSafeInteger(minute) ||
    minute < 0 ||
    !Number.isFinite(start + minute * 60_000)
  ) {
    throw new Error("行程分钟数无效。");
  }
  const result = new Date(start + minute * 60_000);
  if (!Number.isFinite(result.getTime())) {
    throw new Error("行程时间超出支持范围。");
  }
  return result.toISOString();
}

export type IntercityRole = "arrival" | "return";
export type UserStation = {
  id: string;
  name: string;
  location: Coordinate | null;
};
export type ManualIntercitySegment = {
  id: string;
  role: IntercityRole;
  mode: "rail" | "flight";
  serviceNumber: string | null;
  origin: UserStation;
  destination: UserStation;
  departureAt: string;
  arrivalAt: string;
  timeZone: typeof intercityTimeZone;
  terminalBufferMinutes: number | null;
  farePerPersonFen: number | null;
  source: { kind: "user"; recordedAt: string };
};
export type IntercityConnection = {
  fromId: string;
  toId: string;
  seconds: number | null;
  source: Source;
};
export type IntercitySetup = {
  segments: ManualIntercitySegment[];
  connections: Partial<Record<IntercityRole, IntercityConnection | null>>;
};

export function emptyIntercity(): IntercitySetup {
  return { segments: [], connections: {} };
}

// Both roles must be priced: a partial fare is not a complete round-trip estimate.
export function roundTripFareFen(segments: ManualIntercitySegment[]): number | null {
  if (segments.length !== 2) {
    return null;
  }
  let total = 0;
  for (const role of ["arrival", "return"] as const) {
    const segment = segments.find((item) => item.role === role);
    if (!segment || segment.farePerPersonFen === null) {
      return null;
    }
    total += segment.farePerPersonFen;
  }
  return total;
}

export function toShanghaiLocalDateTime(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) {
    throw new Error("班次时间无效。");
  }
  return new Date(epoch + 8 * hourMs).toISOString().slice(0, 16);
}

export type BoundaryCheck = {
  role: IntercityRole;
  segmentId: string | null;
  state: "compatible" | "unknown" | "conflict";
  message: string;
  slackSeconds: number | null;
  activityAt: string | null;
  boundaryAt: string | null;
};
export type IntercityReport = {
  status: "unverified" | "infeasible";
  checks: BoundaryCheck[];
  notices: string[];
};

// Inputs must first pass the runtime contract. A compatible time is NOT a verified ticket.
// Connection seconds are the COMPLETE route duration, including any provider waiting time.
export function evaluateIntercity(
  draft: Draft,
  segments: ManualIntercitySegment[],
  connections: Partial<Record<IntercityRole, IntercityConnection | null>>,
): IntercityReport {
  if (
    segments.length > 2 ||
    new Set(segments.map((segment) => segment.role)).size !== segments.length
  ) {
    throw new Error("到达与返程最多各录入一个班次。");
  }
  const firstDay = draft.days[0];
  const lastDay = draft.days.at(-1);
  const first = firstDay?.items[0];
  const last = lastDay?.items.at(-1);
  const checks: BoundaryCheck[] = (["arrival", "return"] as const).map((role) => {
    const segment = segments.find((item) => item.role === role);
    const day = role === "arrival" ? firstDay : lastDay;
    const stop = role === "arrival" ? first : last;
    const activityAt =
      day && stop
        ? atShanghaiMinute(
            day.date,
            role === "arrival" ? stop.startMinute : stop.endMinute,
          )
        : null;
    const base: BoundaryCheck = {
      role,
      segmentId: segment?.id ?? null,
      state: "unknown",
      message: "",
      slackSeconds: null,
      activityAt,
      boundaryAt: null,
    };
    if (!segment) {
      return {
        ...base,
        message: role === "arrival" ? "尚未录入到达班次。" : "尚未录入返程班次。",
      };
    }
    const boundaryAt = role === "arrival" ? segment.arrivalAt : segment.departureAt;
    const known = { ...base, boundaryAt };
    if (!activityAt || !stop) {
      return { ...known, message: "活动时间未知，不能校验跨城接驳。" };
    }
    const connection = connections[role];
    const station = role === "arrival" ? segment.destination : segment.origin;
    const fromId = role === "arrival" ? station.id : stop.place.id;
    const toId = role === "arrival" ? stop.place.id : station.id;
    const sameDirection = connection?.fromId === fromId && connection?.toId === toId;
    const routeSeconds = connection && sameDirection ? connection.seconds : null;
    if (routeSeconds !== null && (!Number.isFinite(routeSeconds) || routeSeconds < 0)) {
      throw new Error("接驳耗时无效。");
    }
    const clockSlack =
      role === "arrival"
        ? (Date.parse(activityAt) - Date.parse(boundaryAt)) / 1000
        : (Date.parse(boundaryAt) - Date.parse(activityAt)) / 1000;
    if (!Number.isFinite(clockSlack)) {
      throw new Error("班次时间无效。");
    }
    // Unknown nonnegative durations only contribute a mathematical lower bound here.
    // Never present that bound as an estimate or exact slack.
    const minimumKnownSeconds =
      (segment.terminalBufferMinutes ?? 0) * 60 + (routeSeconds ?? 0);
    const incomplete = routeSeconds === null || segment.terminalBufferMinutes === null;
    if (incomplete && clockSlack < minimumKnownSeconds) {
      return {
        ...known,
        state: "conflict",
        message: "已知时间或缓冲已冲突；未校验部分仍未知，当前安排保持不变。",
      };
    }
    if (!connection || connection.seconds === null) {
      return { ...known, message: "接驳耗时未知，不按零分钟计算。" };
    }
    if (!sameDirection) {
      return { ...known, message: "接驳方向或端点已变化，请重新查询。" };
    }
    if (segment.terminalBufferMinutes === null) {
      return { ...known, message: "进出站缓冲未知，尚不能判断是否赶得上。" };
    }
    const bufferSeconds = segment.terminalBufferMinutes * 60;
    const slackSeconds = clockSlack - bufferSeconds - connection.seconds;
    if (!Number.isFinite(slackSeconds)) {
      throw new Error("班次时间无效。");
    }
    return {
      ...known,
      slackSeconds,
      state: slackSeconds < 0 ? "conflict" : "compatible",
      message:
        slackSeconds < 0
          ? role === "arrival"
            ? "到达与接驳晚于首个活动，当前安排保持不变。"
            : "末个活动与接驳无法赶上返程，当前安排保持不变。"
          : "仅时间估算相容；班次、车站、票务和接驳仍需核实。",
    };
  });
  const arrival = segments.find((item) => item.role === "arrival");
  const returning = segments.find((item) => item.role === "return");
  const chronologicalConflict = Boolean(
    arrival &&
    returning &&
    Date.parse(arrival.arrivalAt) >= Date.parse(returning.departureAt),
  );
  const notices = [
    "跨城班次和费用为用户录入，不代表实时票价、余票或已出票；不会自动修改行程或预算。",
  ];
  if (chronologicalConflict) {
    notices.push("返程出发不晚于到达，跨城时间冲突。");
  }
  return {
    status:
      chronologicalConflict || checks.some((check) => check.state === "conflict")
        ? "infeasible"
        : "unverified",
    checks,
    notices,
  };
}
