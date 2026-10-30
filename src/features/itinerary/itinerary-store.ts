import { create } from "zustand";
import type { Itinerary } from "@/domain/itinerary";
import { z } from "zod";
import {
  itinerarySchema,
  itineraryChangeSchema,
  itineraryRouteResolutionSchema,
} from "@/lib/itinerary-contracts";
import {
  prepareItineraryMove,
  type ItineraryRouteResolution,
} from "@/domain/itinerary-moves";
import {
  changeItinerary,
  rescheduleItinerary,
  assertItineraryTimeLocks,
  type ItineraryChange,
} from "@/domain/itinerary-editing";

type State = {
  plan: Itinerary | null;
  review: {
    id: number;
    plan: Itinerary;
    baseVersion: number;
    change?: ItineraryChange;
    routes: ItineraryRouteResolution[];
  } | null;
  proposalSequence: number;
  resolveMoveRoute: (
    proposalId: number,
    baseVersion: number,
    result: ItineraryRouteResolution,
  ) => void;
  previous: Itinerary | null;
  history: { plan: Itinerary; label: string }[];
  version: number;
  receive: (plan: Itinerary, baseVersion: number) => void;
  proposeChange: (change: ItineraryChange) => void;
  confirm: () => void;
  cancelReview: () => void;
  undo: () => void;
};
// Ephemeral page drafts only: not server ownership, persistence or transaction history.
export const useItineraryStore = create<State>((set, get) => ({
  plan: null,
  review: null,
  previous: null,
  history: [],
  version: 0,
  proposalSequence: 0,
  resolveMoveRoute(proposalId, baseVersion, input) {
    const state = get();
    if (
      !state.plan ||
      !state.review ||
      state.review.id !== proposalId ||
      state.review.baseVersion !== baseVersion ||
      state.version !== baseVersion ||
      state.review.change?.kind !== "move"
    ) {
      throw new Error("预览已关闭或行程已变化，路线结果未应用。");
    }
    const result = itineraryRouteResolutionSchema.parse(input);
    const routes = z
      .array(itineraryRouteResolutionSchema)
      .max(3)
      .parse([...state.review.routes, result]);
    const plan = itinerarySchema.parse(
      changeItinerary(state.plan, state.review.change, routes),
    );
    set({ review: { ...state.review, plan, routes } });
  },
  receive(input, baseVersion) {
    const state = get();
    if (baseVersion !== state.version) {
      throw new Error("当前方案已变化，请重新生成，不会覆盖其间修改。");
    }
    const plan = itinerarySchema.parse(input);
    if (state.plan) {
      const id = state.proposalSequence + 1;
      set({ review: { id, plan, baseVersion, routes: [] }, proposalSequence: id });
    } else {
      set({ plan, previous: null, history: [], version: state.version + 1 });
    }
  },
  proposeChange(input) {
    const state = get();
    if (!state.plan || state.review) {
      throw new Error("请先确认或取消当前预览，再调整活动。");
    }
    const change = itineraryChangeSchema.parse(input);
    const plan = itinerarySchema.parse(
      changeItinerary(itinerarySchema.parse(state.plan), change),
    );
    const id = state.proposalSequence + 1;
    set({
      review: { id, plan, baseVersion: state.version, change, routes: [] },
      proposalSequence: id,
    });
  },
  confirm() {
    const state = get();
    if (!state.review || state.review.baseVersion !== state.version) {
      throw new Error("当前方案已变化，请重新生成预览。");
    }
    const change = state.review.change
      ? itineraryChangeSchema.parse(state.review.change)
      : null;
    const routes = z
      .array(itineraryRouteResolutionSchema)
      .max(3)
      .parse(state.review.routes);
    if (
      change?.kind === "move" &&
      state.plan &&
      prepareItineraryMove(state.plan, change, routes).missing.length > 0
    ) {
      throw new Error("请先查询受影响的路线，再确认修改。");
    }
    if (!change && routes.length > 0) {
      throw new Error("整份方案替换不能附带局部路线结果。");
    }
    const plan = itinerarySchema.parse(
      change && state.plan
        ? changeItinerary(itinerarySchema.parse(state.plan), change, routes)
        : rescheduleItinerary(itinerarySchema.parse(state.review.plan)),
    );
    if (state.plan) {
      assertItineraryTimeLocks(
        state.plan,
        plan,
        change?.kind === "time_lock" && !change.locked ? change.activityId : undefined,
        change?.kind === "position_lock" && !change.locked
          ? change.activityId
          : undefined,
        false,
        change?.kind === "venue_rules" && change.reservationRelease
          ? change.activityId
          : undefined,
      );
    }
    if (plan.status === "infeasible") {
      throw new Error("修改存在时间或预约冲突，当前方案保持不变。");
    }
    const previousHistory =
      state.previous && state.history.at(-1)?.plan === state.previous
        ? state.history
        : [];
    const name =
      change && change.kind !== "expenses"
        ? (state.plan?.days
            .flatMap((day) => day.schedule?.items ?? [])
            .find((item) => item.activity.id === change.activityId)?.activity.place
            .name ?? "活动")
        : "";
    const labels = {
      duration: "停留时间",
      time_lock: "时间锁",
      position_lock: "位置锁",
      move: "日期与次序",
      venue_rules: "营业预约记录",
      expenses: "全程费用估算",
    };
    const label = change ? `${name}${labels[change.kind]}` : "整份旅行方案";
    const history = state.plan
      ? [...previousHistory.slice(-9), { plan: state.plan, label }]
      : previousHistory;
    set({
      previous: state.plan,
      history,
      plan,
      review: null,
      version: state.version + 1,
    });
  },
  cancelReview() {
    set({ review: null });
  },
  undo() {
    const state = get();
    if (!state.previous) {
      throw new Error("没有可撤销的方案替换。");
    }
    const available =
      state.history.at(-1)?.plan === state.previous
        ? state.history
        : [{ plan: state.previous, label: "上次修改" }];
    const history = available.slice(0, -1);
    set({
      plan: state.previous,
      previous: history.at(-1)?.plan ?? null,
      history,
      review: null,
      version: state.version + 1,
    });
  },
}));
