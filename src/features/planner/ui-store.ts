"use client";
import { create } from "zustand";

type UiState = {
  dayIndex: number;
  selectedId: string | null;
  mobileTab: "itinerary" | "map";
  select: (id: string) => void;
  changeDay: (index: number) => void;
  changeTab: (tab: "itinerary" | "map") => void;
  reset: () => void;
};
export const usePlannerUi = create<UiState>((set) => ({
  dayIndex: 0,
  selectedId: null,
  mobileTab: "itinerary",
  select: (id) => set({ selectedId: id }),
  changeDay: (dayIndex) => set({ dayIndex, selectedId: null }),
  changeTab: (mobileTab) => set({ mobileTab }),
  reset: () => set({ dayIndex: 0, selectedId: null, mobileTab: "itinerary" }),
}));
