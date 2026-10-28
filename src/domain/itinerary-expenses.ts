import {
  budgetCategories,
  emptyBudget,
  type BudgetCategory,
  type BudgetEstimate,
  type BudgetSummary,
} from "./budget";
import { briefBudget, type TripBrief } from "./trip-brief";

export type ItineraryExpenses = Pick<BudgetEstimate, "items">;
export function emptyItineraryExpenses(): ItineraryExpenses {
  return { items: emptyBudget().items };
}
export function expenseIncluded(brief: TripBrief, category: BudgetCategory): boolean {
  return category === "intercity"
    ? brief.budget.includeIntercity
    : category === "lodging"
      ? brief.budget.includeLodging
      : true;
}
export function summarizeItineraryExpenses(
  brief: TripBrief,
  expenses: ItineraryExpenses,
): BudgetSummary {
  if (!Number.isInteger(brief.travelers) || brief.travelers < 1 || brief.travelers > 20) {
    throw new Error("同行人数须为 1—20 的整数。");
  }
  const targetTotalFen = briefBudget(brief).totalFen;
  const categoryTotals = {} as BudgetSummary["categoryTotals"];
  const missing: BudgetCategory[] = [];
  let knownTotalFen = 0;
  for (const category of budgetCategories) {
    const entry = expenses.items[category];
    if (
      !entry ||
      (entry.basis !== "per_person" && entry.basis !== "trip") ||
      (entry.amountFen !== null &&
        (!Number.isSafeInteger(entry.amountFen) ||
          entry.amountFen < 0 ||
          entry.amountFen > 10_000_000))
    ) {
      throw new Error("每项费用须为不超过十万元的非负金额，最多两位小数，并明确口径。");
    }
    if (
      entry.amountFen === null
        ? entry.source !== null
        : entry.source?.kind !== "user" ||
          !Number.isFinite(Date.parse(entry.source.recordedAt))
    ) {
      throw new Error("费用与手动估算来源不一致。");
    }
    if (!expenseIncluded(brief, category)) {
      categoryTotals[category] = null;
      continue;
    }
    if (entry.amountFen === null) {
      categoryTotals[category] = null;
      missing.push(category);
      continue;
    }
    const total = entry.amountFen * (entry.basis === "per_person" ? brief.travelers : 1);
    categoryTotals[category] = total;
    knownTotalFen += total;
  }
  return {
    targetTotalFen,
    knownTotalFen,
    perPersonCeilingFen: Math.ceil(knownTotalFen / brief.travelers),
    missing,
    complete: missing.length === 0,
    status:
      knownTotalFen > targetTotalFen
        ? "over"
        : missing.length
          ? "unknown"
          : "within_estimate",
    categoryTotals,
  };
}
