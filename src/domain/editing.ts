import { makeDay, makeDraft } from "./draft";
import type { Coordinate, Draft, Leg, Route } from "./models";
import { emptyBudget, summarizeBudget, type BudgetEstimate } from "./budget";
import {
  activeMealConnections,
  applyVisitConnections,
  deferredVisitRoute,
  deriveMealTrip,
  emptyMeals,
  mergeMealConnections,
  visitActivityId,
  type MealSetup,
  type MealTripView,
} from "./meals";
import {
  emptyIntercity,
  evaluateIntercity,
  type IntercitySetup,
  type IntercityReport,
} from "./intercity";

import {
  reservationReleaseConflicts,
  reservationKey,
  type MealReservationRelease,
} from "./meal-reservations";

import type { VenueRules } from "./meal-planning";

export type StopLock = {
  position?: { dayIndex: number; index: number };
  time?: { date: string; minute: number };
};
export type EditSnapshot = {
  draft: Draft;
  locks: Record<string, StopLock>;
  budget: BudgetEstimate;
  intercity: IntercitySetup;
  meals: MealSetup;
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
  fromActivityId: string;
  toActivityId: string;
  origin: Coordinate;
  destination: Coordinate;
};
export type EditProposal = {
  sessionId: string;
  baseVersion: number;
  operation: StopChange;
  draft: Draft;
  effectiveDraft: Draft;
  meals: MealSetup;
  gaps: RouteGap[];
  routes: Route[] | null;
  conflicts: string[];
};

export function createEditState(draft: Draft, sessionId: string): EditState {
  return {
    draft,
    sessionId,
    version: 0,
    locks: {},
    budget: emptyBudget(),
    intercity: emptyIntercity(),
    meals: emptyMeals(),
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
    const index = day.items.findIndex(
      (item) => item.place.id === placeId && (item.purpose ?? "visit") === "visit",
    );
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
  resolvedRoutes: Route[] | null,
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
  const days = groups.map((items, dayIndex) => {
    const legs: Leg[] = items.slice(1).map((item, index) => {
      const from = items[index].place;
      const to = item.place;
      const old = existing.get(pairKey(from.id, to.id));
      if (old) {
        return old;
      }
      return {
        fromId: from.id,
        toId: to.id,
        route: null,
        error: deferredVisitRoute,
      };
    });
    const timing = Object.fromEntries(
      items.map((item) => [
        item.place.id,
        {
          stayMinutes: item.stayMinutes,
          fixedStartMinute: locks[item.place.id]?.time?.minute,
          venueRules: item.venueRules,
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
  let candidate = makeDraft(input, days, notices);
  const initial = deriveMealTrip(candidate, locks, state.meals, false);
  const activityPlaces = new Map(
    initial.draft.days.flatMap((day) =>
      day.items.map(
        (item) =>
          [item.activityId ?? visitActivityId(item.place.id), item.place] as const,
      ),
    ),
  );
  const gaps: RouteGap[] = initial.gaps.map((gap) => ({
    fromId: activityPlaces.get(gap.fromId)!.id,
    toId: activityPlaces.get(gap.toId)!.id,
    fromActivityId: gap.fromId,
    toActivityId: gap.toId,
    origin: [...gap.origin],
    destination: [...gap.destination],
  }));
  if (resolvedRoutes !== null && resolvedRoutes.length !== gaps.length) {
    throw new Error("路线结果与受影响路段不一致，未应用修改。");
  }
  const meals =
    resolvedRoutes === null
      ? state.meals
      : mergeMealConnections(state.meals, initial.gaps, resolvedRoutes);
  candidate = applyVisitConnections(candidate, locks, meals.connections);
  const ready = gaps.length === 0 || resolvedRoutes !== null;
  const mealView = deriveMealTrip(candidate, locks, meals, ready);
  const effectiveDraft = mealView.draft;
  const conflicts: string[] = [...mealView.conflicts];
  if (ready && mealView.gaps.length) {
    conflicts.push("用餐影响的路线已变化，请先重新预览餐次并查询局部接驳。");
  }
  for (const [id, lock] of Object.entries(locks)) {
    const next = locate(effectiveDraft, id);
    if (
      lock.position &&
      (next.dayIndex !== lock.position.dayIndex || next.index !== lock.position.index)
    ) {
      conflicts.push(`“${next.item.place.name}”的日期与顺序位置已锁定，请先解锁。`);
    }
    if (
      lock.time &&
      (effectiveDraft.days[next.dayIndex].date !== lock.time.date ||
        (ready && next.item.startMinute !== lock.time.minute))
    ) {
      conflicts.push(`无法保证“${next.item.place.name}”的锁定时间，请调整安排或先解锁。`);
    }
  }
  const boundary = evaluateIntercity(
    effectiveDraft,
    state.intercity.segments,
    state.intercity.connections,
  );
  if (state.intercity.segments.length && boundary.status === "infeasible") {
    conflicts.push("修改与已录入的到达／返程约束冲突，请调整安排或先修正班次。");
  }
  if (conflicts.length) {
    candidate.status = "infeasible";
    effectiveDraft.status = "infeasible";
  }
  return {
    sessionId: state.sessionId,
    baseVersion: state.version,
    operation,
    draft: candidate,
    effectiveDraft,
    meals,
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
  routes: Route[],
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
  if (checked.conflicts.length || checked.effectiveDraft.status === "infeasible") {
    throw new Error("修改存在时间或锁定冲突，当前行程保持不变。");
  }
  return {
    ...state,
    draft: checked.draft,
    meals: activeMealConnections(checked.meals, checked.effectiveDraft),
    version: state.version + 1,
    previous: snapshot(state),
  };
}

export function toggleStopLock(
  state: EditState,
  placeId: string,
  kind: "position" | "time",
): EditState {
  const current = locate(
    deriveMealTrip(state.draft, state.locks, state.meals).draft,
    placeId,
  );
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
  return {
    draft: state.draft,
    locks: state.locks,
    budget: state.budget,
    intercity: state.intercity,
    meals: state.meals,
  };
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

export type IntercityProposal = {
  sessionId: string;
  baseVersion: number;
  setup: IntercitySetup;
  report: IntercityReport;
};

export function previewIntercity(
  state: EditState,
  setup: IntercitySetup,
): IntercityProposal {
  const copy = structuredClone(setup);
  return {
    sessionId: state.sessionId,
    baseVersion: state.version,
    setup: copy,
    report: evaluateIntercity(
      deriveMealTrip(state.draft, state.locks, state.meals).draft,
      copy.segments,
      copy.connections,
    ),
  };
}

export function commitIntercity(
  state: EditState,
  proposal: IntercityProposal,
  acknowledgeConflict = false,
): EditState {
  if (proposal.sessionId !== state.sessionId || proposal.baseVersion !== state.version) {
    throw new Error("行程已变化，请重新预览跨城安排。");
  }
  const checked = previewIntercity(state, proposal.setup);
  if (checked.report.status === "infeasible" && !acknowledgeConflict) {
    throw new Error("跨城安排存在冲突；请先确认仅记录含冲突的草稿。");
  }
  return {
    ...state,
    intercity: checked.setup,
    version: state.version + 1,
    previous: snapshot(state),
  };
}

export type MealProposal = {
  sessionId: string;
  baseVersion: number;
  setup: MealSetup;
  reservationReleases: MealReservationRelease[];
  view: MealTripView;
};

export function previewMeals(
  state: EditState,
  setup: MealSetup,
  reservationReleases: MealReservationRelease[] = [],
): MealProposal {
  const copy = structuredClone(setup);
  const releases = structuredClone(reservationReleases);
  const conflicts = reservationReleaseConflicts(state.meals, copy, releases);
  let view = deriveMealTrip(structuredClone(state.draft), state.locks, copy, false);
  if (view.gaps.length === 0) {
    view = deriveMealTrip(structuredClone(state.draft), state.locks, copy);
  }
  const boundary = evaluateIntercity(
    view.draft,
    state.intercity.segments,
    state.intercity.connections,
  );
  if (state.intercity.segments.length && boundary.status === "infeasible") {
    view.conflicts.push("用餐安排与已录入的到达／返程约束冲突。");
    view.draft.status = "infeasible";
  }
  if (conflicts.length) {
    view.conflicts.push(...conflicts);
    view.draft.status = "infeasible";
  }
  return {
    sessionId: state.sessionId,
    baseVersion: state.version,
    setup: copy,
    reservationReleases: releases,
    view,
  };
}

export function resolveMeals(
  state: EditState,
  proposal: MealProposal,
  routes: Route[],
): MealProposal {
  if (proposal.sessionId !== state.sessionId || proposal.baseVersion !== state.version) {
    throw new Error("行程已变化，请重新预览用餐安排。");
  }
  const checked = previewMeals(state, proposal.setup, proposal.reservationReleases);
  assertReservationReleases(state, checked);
  return previewMeals(
    state,
    mergeMealConnections(checked.setup, checked.view.gaps, routes),
    checked.reservationReleases,
  );
}

function assertReservationReleases(state: EditState, proposal: MealProposal) {
  const conflicts = reservationReleaseConflicts(
    state.meals,
    proposal.setup,
    proposal.reservationReleases,
  );
  if (conflicts.length) {
    throw new Error(conflicts.join(" "));
  }
}

export function commitMeals(state: EditState, proposal: MealProposal): EditState {
  if (proposal.sessionId !== state.sessionId || proposal.baseVersion !== state.version) {
    throw new Error("行程已变化，请重新预览用餐安排。");
  }
  const checked = previewMeals(state, proposal.setup, proposal.reservationReleases);
  assertReservationReleases(state, checked);
  if (checked.view.gaps.length) {
    throw new Error("请先查询用餐影响的路线，再确认修改。");
  }
  if (checked.view.conflicts.length || checked.view.draft.status === "infeasible") {
    throw new Error("用餐安排存在时间或锁定冲突，当前行程保持不变。");
  }
  return {
    ...state,
    draft: applyVisitConnections(state.draft, state.locks, checked.setup.connections),
    meals: activeMealConnections(checked.setup, checked.view.draft),
    version: state.version + 1,
    previous: snapshot(state),
  };
}

export type VisitRulesProposal = {
  sessionId: string;
  baseVersion: number;
  placeId: string;
  rules: VenueRules | null;
  release: MealReservationRelease | null;
  requiredRelease: MealReservationRelease | null;
  draft: Draft;
  view: MealTripView;
};
export function previewVisitRules(
  state: EditState,
  placeId: string,
  rules: VenueRules | null,
  release: MealReservationRelease | null = null,
): VisitRulesProposal {
  const original = locate(state.draft, placeId);
  const draft = structuredClone(state.draft);
  const copy = structuredClone(rules);
  draft.days[original.dayIndex].items[original.index].venueRules = copy;
  const activity = {
    id: visitActivityId(placeId),
    kind: "visit" as const,
    place: original.item.place,
    fixedStartMinute: state.locks[placeId]?.time?.minute ?? null,
  };
  const date = state.draft.days[original.dayIndex].date;
  const beforeKey = reservationKey(date, {
    ...activity,
    rules: original.item.venueRules ?? null,
  });
  const afterKey = reservationKey(date, { ...activity, rules: copy });
  const requiredRelease =
    original.item.venueRules?.reservation.state === "confirmed" && beforeKey !== afterKey
      ? { activityId: activity.id, beforeKey, afterKey }
      : null;
  if (
    release &&
    (!requiredRelease ||
      Object.keys(release).length !== 3 ||
      release.activityId !== requiredRelease.activityId ||
      release.beforeKey !== beforeKey ||
      release.afterKey !== afterKey)
  ) {
    throw new Error("景点预约变更核对与当前修改不一致，请重新预览。");
  }
  const view = deriveMealTrip(draft, state.locks, state.meals);
  if (requiredRelease && !release) {
    view.conflicts.push(
      "景点已记录预约将变更或移除，请针对当前修改明确核对；此操作不代为取消预约。",
    );
  }
  if (
    state.intercity.segments.length &&
    evaluateIntercity(view.draft, state.intercity.segments, state.intercity.connections)
      .status === "infeasible"
  ) {
    view.conflicts.push("景点规则修改与已录入的到达／返程约束冲突。");
  }
  if (view.conflicts.length) {
    view.draft.status = "infeasible";
  }
  return {
    sessionId: state.sessionId,
    baseVersion: state.version,
    placeId,
    rules: copy,
    release: structuredClone(release),
    requiredRelease,
    draft,
    view,
  };
}
export function commitVisitRules(
  state: EditState,
  proposal: VisitRulesProposal,
): EditState {
  if (state.sessionId !== proposal.sessionId || state.version !== proposal.baseVersion) {
    throw new Error("行程已变化，请重新预览景点规则。");
  }
  const checked = previewVisitRules(
    state,
    proposal.placeId,
    proposal.rules,
    proposal.release,
  );
  if (checked.requiredRelease && !checked.release) {
    throw new Error("景点预约变更须明确核对，当前规则保持不变。");
  }
  if (
    checked.view.gaps.length ||
    checked.view.conflicts.length ||
    checked.view.draft.status === "infeasible"
  ) {
    throw new Error("景点规则存在时间、预约、锁定或接驳冲突，当前行程保持不变。");
  }
  return {
    ...state,
    draft: checked.draft,
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
