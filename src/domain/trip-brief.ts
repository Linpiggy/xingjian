import { addDays } from "./draft";

export const tripPurposes = [
  "local_life",
  "culture",
  "nature",
  "food",
  "relaxation",
  "photography",
] as const;
export type TripPurpose = (typeof tripPurposes)[number];
export const tripPurposeLabels: Record<TripPurpose, string> = {
  local_life: "民风与当地生活",
  culture: "历史与文化",
  nature: "自然美景",
  food: "特色美食",
  relaxation: "休闲放松",
  photography: "打卡与摄影",
};
export type TripBrief = {
  destinationCity: string;
  originCity: string | null;
  startDate: string;
  dayCount: number;
  travelers: number;
  budget: {
    amountFen: number;
    basis: "per_person" | "total";
    includeIntercity: boolean;
    includeLodging: boolean;
  };
  availability: {
    firstDayStartMinute: number;
    lastDayEndMinute: number;
    dailyStartMinute: number;
    dailyEndMinute: number;
  };
  mainPurpose: TripPurpose;
  secondaryPurposes: TripPurpose[];
  pace: "relaxed" | "balanced" | "packed";
  mustVisit: string[];
  mustEat: { kind: "dish" | "restaurant"; name: string }[];
  dietary: { avoid: string[]; allergies: string[] };
};
export type BriefDay = {
  date: string;
  activityWindow: { startMinute: number; endMinute: number } | null;
};

// Requires validated input. A late arrival may leave no touring window; never delete that date.
export function briefDays(brief: TripBrief): BriefDay[] {
  return Array.from({ length: brief.dayCount }, (_, index) => {
    const startMinute = Math.max(
      brief.availability.dailyStartMinute,
      index === 0 ? brief.availability.firstDayStartMinute : 0,
    );
    const endMinute = Math.min(
      brief.availability.dailyEndMinute,
      index === brief.dayCount - 1 ? brief.availability.lastDayEndMinute : 1440,
    );
    return {
      date: addDays(brief.startDate, index),
      activityWindow: startMinute < endMinute ? { startMinute, endMinute } : null,
    };
  });
}
export function briefBudget(brief: TripBrief) {
  const totalFen =
    brief.budget.amountFen * (brief.budget.basis === "per_person" ? brief.travelers : 1);
  const perPersonFloorFen = Math.floor(totalFen / brief.travelers);
  return {
    totalFen,
    perPersonFloorFen,
    remainderFen: totalFen - perPersonFloorFen * brief.travelers,
  };
}
// Equal daily targets only, not queried daily expenses or transport timing allocations.
export function dailyBudgetTargetFen(brief: TripBrief, dayIndex: number): number {
  if (!Number.isInteger(dayIndex) || dayIndex < 0 || dayIndex >= brief.dayCount) {
    throw new Error("预算参考日期超出本次旅行范围。");
  }
  const total = briefBudget(brief).totalFen;
  return Math.floor(total / brief.dayCount) + (dayIndex < total % brief.dayCount ? 1 : 0);
}
