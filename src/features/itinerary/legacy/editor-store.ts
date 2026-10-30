"use client";

import { create } from "zustand";
import type { Draft } from "@/domain/models";
import { intercitySetupSchema } from "@/lib/intercity-contracts";
import { venueRulesSchema } from "@/lib/venue-contracts";
import {
  mealSetupSchema,
  mealReservationReleasesSchema,
} from "@/lib/meal-setup-contracts";
import {
  commitEdit,
  commitBudget,
  commitIntercity,
  commitMeals,
  commitVisitRules,
  type VisitRulesProposal,
  type MealProposal,
  type IntercityProposal,
  createEditState,
  toggleStopLock,
  undoEdit,
  type EditProposal,
  type EditState,
  type BudgetProposal,
} from "@/domain/editing";

type EditorStore = {
  current: EditState | null;
  start: (draft: Draft) => void;
  reset: () => void;
  confirm: (proposal: EditProposal) => void;
  confirmBudget: (proposal: BudgetProposal) => void;
  confirmIntercity: (proposal: IntercityProposal, acknowledgeConflict: boolean) => void;
  confirmMeals: (proposal: MealProposal) => void;
  confirmVisitRules: (proposal: VisitRulesProposal) => void;
  toggleLock: (id: string, kind: "position" | "time") => void;
  undo: () => void;
};

function required(current: EditState | null): EditState {
  if (!current) {
    throw new Error("当前行程已关闭，请重新选择计划。");
  }
  return current;
}

export const useDraftEditor = create<EditorStore>((set, get) => ({
  current: null,
  start: (draft) => set({ current: createEditState(draft, crypto.randomUUID()) }),
  reset: () => set({ current: null }),
  confirm: (proposal) => {
    set({ current: commitEdit(required(get().current), proposal) });
  },
  confirmBudget: (proposal) => {
    set({ current: commitBudget(required(get().current), proposal) });
  },
  confirmIntercity: (proposal, acknowledgeConflict) => {
    const setup = intercitySetupSchema.parse(proposal.setup);
    set({
      current: commitIntercity(
        required(get().current),
        { ...proposal, setup },
        acknowledgeConflict,
      ),
    });
  },
  confirmMeals: (proposal) => {
    const setup = mealSetupSchema.parse(proposal.setup);
    const reservationReleases = mealReservationReleasesSchema.parse(
      proposal.reservationReleases,
    );
    set({
      current: commitMeals(required(get().current), {
        ...proposal,
        setup,
        reservationReleases,
      }),
    });
  },
  confirmVisitRules: (proposal) => {
    const rules = venueRulesSchema.nullable().parse(proposal.rules);
    const releases = mealReservationReleasesSchema.parse(
      proposal.release === null ? [] : [proposal.release],
    );
    set({
      current: commitVisitRules(required(get().current), {
        ...proposal,
        rules,
        release: releases[0] ?? null,
      }),
    });
  },
  toggleLock: (id, kind) => {
    set({ current: toggleStopLock(required(get().current), id, kind) });
  },
  undo: () => {
    set({ current: undoEdit(required(get().current)) });
  },
}));
