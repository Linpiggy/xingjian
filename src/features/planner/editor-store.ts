"use client";

import { create } from "zustand";
import type { Draft } from "@/domain/models";
import {
  commitEdit,
  commitBudget,
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
  toggleLock: (id, kind) => {
    set({ current: toggleStopLock(required(get().current), id, kind) });
  },
  undo: () => {
    set({ current: undoEdit(required(get().current)) });
  },
}));
