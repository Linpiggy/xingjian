import { create } from "zustand";
import type { Itinerary } from "@/domain/itinerary";
import { itinerarySchema } from "@/lib/itinerary-contracts";

type State = {
  plan: Itinerary | null;
  review: { plan: Itinerary; baseVersion: number } | null;
  previous: Itinerary | null;
  version: number;
  receive: (plan: Itinerary, baseVersion: number) => void;
  confirm: () => void;
  cancelReview: () => void;
  undo: () => void;
};
// Ephemeral page drafts only: not server ownership, persistence or transaction history.
export const useItineraryStore = create<State>((set, get) => ({
  plan: null,
  review: null,
  previous: null,
  version: 0,
  receive(input, baseVersion) {
    const state = get();
    if (baseVersion !== state.version) {
      throw new Error("当前方案已变化，请重新生成，不会覆盖其间修改。");
    }
    const plan = itinerarySchema.parse(input);
    if (state.plan) {
      set({ review: { plan, baseVersion } });
    } else {
      set({ plan, version: state.version + 1 });
    }
  },
  confirm() {
    const state = get();
    if (!state.review || state.review.baseVersion !== state.version) {
      throw new Error("当前方案已变化，请重新生成预览。");
    }
    const plan = itinerarySchema.parse(state.review.plan);
    set({ previous: state.plan, plan, review: null, version: state.version + 1 });
  },
  cancelReview() {
    set({ review: null });
  },
  undo() {
    const state = get();
    if (!state.previous) {
      throw new Error("没有可撤销的方案替换。");
    }
    set({
      plan: state.previous,
      previous: null,
      review: null,
      version: state.version + 1,
    });
  },
}));
