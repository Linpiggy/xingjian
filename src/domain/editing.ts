import { makeDay, makeDraft } from "./draft";
import type { Coordinate, Draft, Leg, WalkingRoute } from "./models";
import { emptyBudget, summarizeBudget, type BudgetEstimate } from "./budget";

export type StopLock = {
  position?: { dayIndex: number; index: number };
  time?: { date: string; minute: number };
};
export type EditSnapshot = {
  draft: Draft;
  locks: Record<string, StopLock>;
  budget: BudgetEstimate;
};
export type EditState = EditSnapshot & {
  sessionId: string;
  version: number;
  previous: EditSnapshot | null;
};
export type StopChange = {
  placeId: string;
  toDay: number;
  toIndex: number;
  stayMinutes: number;
};
export type RouteGap = {
  fromId: string;
  toId: string;
  origin: Coordinate;
  destination: Coordinate;
};
export type EditProposal = {
  sessionId: string;
  baseVersion: number;
  operation: StopChange;
  draft: Draft;
  gaps: RouteGap[];
  routes: WalkingRoute[] | null;
  conflicts: string[];
};

export function createEditState(draft: Draft, sessionId: string): EditState {
  return {
    draft,
    sessionId,
    version: 0,
    locks: {},
    budget: emptyBudget(),
    previous: null,
  };
}

function assertVersion(state: EditState, proposal: EditProposal) {
  if (proposal.sessionId !== state.sessionId || proposal.baseVersion !== state.version) {
    throw new Error("行程已变化，请重新预览，不会覆盖当前修改。");
  }
}

function locate(draft: Draft, placeId: string) {
  for (const [dayIndex, day] of draft.days.entries()) {
    const index = day.items.findIndex((item) => item.place.id === placeId);
    if (index !== -1) {
      return { dayIndex, index, item: day.items[index] };
    }
  }
  throw new Error("该地点已不在当前行程中。");
}

const pairKey = (from: string, to: string) => JSON.stringify([from, to]);

function buildProposal(
  state: EditState,
  operation: StopChange,
  resolvedRoutes: WalkingRoute[] | null,
): EditProposal {
  const { draft, locks } = state;
  const origin = locate(draft, operation.placeId);
  if (
    !Number.isInteger(operation.stayMinutes) ||
    operation.stayMinutes < 15 ||
    operation.stayMinutes > 240
  ) {
    throw new Error("停留时间须为 15-240 的整数分钟。");
  }
  if (!Number.isInteger(operation.toDay) || !draft.days[operation.toDay]) {
    throw new Error("请选择有效的旅行日期。");
  }
  const groups = draft.days.map((day) => [...day.items]);
  const [moving] = groups[origin.dayIndex].splice(origin.index, 1);
  const destination = groups[operation.toDay];
  if (
    !Number.isInteger(operation.toIndex) ||
    operation.toIndex < 0 ||
    operation.toIndex > destination.length
  ) {
    throw new Error("请选择有效的地点位置。");
  }
  destination.splice(operation.toIndex, 0, {
    ...moving,
    stayMinutes: operation.stayMinutes,
  });
  if (groups.some((group) => !group.length)) {
    throw new Error("每天至少保留一个地点，请调整其他地点。");
  }
  if (
    origin.dayIndex === operation.toDay &&
    origin.index === operation.toIndex &&
    moving.stayMinutes === operation.stayMinutes
  ) {
    throw new Error("没有改变地点位置或停留时间。");
  }
  const existing = new Map(
    draft.days
      .flatMap((day) => day.legs)
      .map((leg) => [pairKey(leg.fromId, leg.toId), leg]),
  );
  const gaps: RouteGap[] = [];
  const days = groups.map((items, dayIndex) => {
    const legs: Leg[] = items.slice(1).map((item, index) => {
      const from = items[index].place;
      const to = item.place;
      const old = existing.get(pairKey(from.id, to.id));
      if (old) {
        return old;
      }
      const routeIndex = gaps.length;
      gaps.push({
        fromId: from.id,
        toId: to.id,
        origin: from.location,
        destination: to.location,
      });
      return {
        fromId: from.id,
        toId: to.id,
        route: resolvedRoutes?.[routeIndex] ?? null,
        error: resolvedRoutes?.[routeIndex] ? null : "路线待重新查询",
      };
    });
    const timing = Object.fromEntries(
      items.map((item) => [
        item.place.id,
        {
          stayMinutes: item.stayMinutes,
          fixedStartMinute: locks[item.place.id]?.time?.minute,
        },
      ]),
    );
    return makeDay(
      draft.days[dayIndex].date,
      items.map((item) => item.place),
      legs,
      draft.input.stayMinutes,
      draft.input.bufferMinutes,
      timing,
    );
  });
  if (resolvedRoutes !== null && resolvedRoutes.length !== gaps.length) {
    throw new Error("路线结果与受影响路段不一致，未应用修改。");
  }
  const oldItems = draft.days.flatMap((day) => day.items);
  const selectionById = new Map(
    oldItems.map((item, index) => [item.place.id, draft.input.selections?.[index]]),
  );
  const items = days.flatMap((day) => day.items);
  const input = {
    ...draft.input,
    keywords: items.map((item) => item.place.name),
    ...(draft.input.selections
      ? {
          selections: items.map((item) => {
            const selection = selectionById.get(item.place.id);
            if (!selection) {
              throw new Error("地点选择信息不一致，未使用无效数据。");
            }
            return selection;
          }),
        }
      : {}),
  };
  const notices = [...draft.notices];
  notices[1] = "按你的调整保留日期与顺序；停留与缓冲时间采用你的设置。";
  const candidate = makeDraft(input, days, notices);
  const ready = gaps.length === 0 || resolvedRoutes !== null;
  const conflicts: string[] = [];
  for (const [id, lock] of Object.entries(locks)) {
    const next = locate(candidate, id);
    if (
      lock.position &&
      (next.dayIndex !== lock.position.dayIndex || next.index !== lock.position.index)
    ) {
      conflicts.push(`“${next.item.place.name}”的日期与顺序位置已锁定，请先解锁。`);
    }
    if (
      lock.time &&
      (candidate.days[next.dayIndex].date !== lock.time.date ||
        (ready && next.item.startMinute !== lock.time.minute))
    ) {
      conflicts.push(`无法保证“${next.item.place.name}”的锁定时间，请调整安排或先解锁。`);
    }
  }
  if (conflicts.length) {
    candidate.status = "infeasible";
  }
  return {
    sessionId: state.sessionId,
    baseVersion: state.version,
    operation,
    draft: candidate,
    gaps,
    routes: ready ? (resolvedRoutes ?? []) : null,
    conflicts,
  };
}

export function previewEdit(state: EditState, operation: StopChange): EditProposal {
  return buildProposal(state, operation, null);
}

export function resolveEdit(
  state: EditState,
  proposal: EditProposal,
  routes: WalkingRoute[],
): EditProposal {
  assertVersion(state, proposal);
  return buildProposal(state, proposal.operation, routes);
}

export function commitEdit(state: EditState, proposal: EditProposal): EditState {
  assertVersion(state, proposal);
  if (proposal.routes === null) {
    throw new Error("请先查询受影响的路线，再确认修改。");
  }
  const checked = resolveEdit(state, proposal, proposal.routes);
  if (checked.conflicts.length || checked.draft.status === "infeasible") {
    throw new Error("修改存在时间或锁定冲突，当前行程保持不变。");
  }
  return {
    ...state,
    draft: checked.draft,
    version: state.version + 1,
    previous: snapshot(state),
  };
}

export function toggleStopLock(
  state: EditState,
  placeId: string,
  kind: "position" | "time",
): EditState {
  const current = locate(state.draft, placeId);
  const lock = { ...state.locks[placeId] };
  if (lock[kind]) {
    delete lock[kind];
  } else if (kind === "position") {
    lock.position = { dayIndex: current.dayIndex, index: current.index };
  } else {
    if (current.item.startMinute === null) {
      throw new Error("开始时间待校验，不能锁定未知时间。");
    }
    lock.time = {
      date: state.draft.days[current.dayIndex].date,
      minute: current.item.startMinute,
    };
  }
  return {
    ...state,
    version: state.version + 1,
    locks: { ...state.locks, [placeId]: lock },
    previous: snapshot(state),
  };
}

function snapshot(state: EditState): EditSnapshot {
  return { draft: state.draft, locks: state.locks, budget: state.budget };
}

export type BudgetProposal = {
  sessionId: string;
  baseVersion: number;
  budget: BudgetEstimate;
};

export function previewBudget(state: EditState, budget: BudgetEstimate): BudgetProposal {
  summarizeBudget(
    budget,
    state.draft.input.travelers,
    state.draft.input.budgetPerPersonFen,
  );
  return { sessionId: state.sessionId, baseVersion: state.version, budget };
}

export function commitBudget(state: EditState, proposal: BudgetProposal): EditState {
  if (proposal.sessionId !== state.sessionId || proposal.baseVersion !== state.version) {
    throw new Error("行程已变化，请重新预览费用。");
  }
  summarizeBudget(
    proposal.budget,
    state.draft.input.travelers,
    state.draft.input.budgetPerPersonFen,
  );
  return {
    ...state,
    budget: proposal.budget,
    version: state.version + 1,
    previous: snapshot(state),
  };
}

export function undoEdit(state: EditState): EditState {
  if (!state.previous) {
    throw new Error("没有可撤销的修改。");
  }
  return { ...state, ...state.previous, version: state.version + 1, previous: null };
}
