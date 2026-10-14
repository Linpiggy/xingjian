export const budgetCategories = [
  "intercity",
  "local",
  "lodging",
  "meals",
  "tickets",
] as const;
export type BudgetCategory = (typeof budgetCategories)[number];
export type ExpenseEstimate = {
  amountFen: number | null;
  basis: "per_person" | "trip";
  source: { kind: "user"; recordedAt: string } | null;
};
export type BudgetEstimate = {
  includeIntercity: boolean;
  items: Record<BudgetCategory, ExpenseEstimate>;
};
export type BudgetSummary = {
  targetTotalFen: number;
  knownTotalFen: number;
  perPersonCeilingFen: number;
  missing: BudgetCategory[];
  complete: boolean;
  status: "unknown" | "over" | "within_estimate";
  categoryTotals: Record<BudgetCategory, number | null>;
};

export function emptyBudget(): BudgetEstimate {
  const unknown = (basis: ExpenseEstimate["basis"]): ExpenseEstimate => ({
    amountFen: null,
    basis,
    source: null,
  });
  return {
    includeIntercity: true,
    items: {
      intercity: unknown("per_person"),
      local: unknown("per_person"),
      lodging: unknown("trip"),
      meals: unknown("per_person"),
      tickets: unknown("per_person"),
    },
  };
}

export function summarizeBudget(
  estimate: BudgetEstimate,
  travelers: number,
  targetPerPersonFen: number,
): BudgetSummary {
  if (!Number.isInteger(travelers) || travelers < 1 || travelers > 8) {
    throw new Error("同行人数须为 1-8 的整数。");
  }
  if (
    !Number.isSafeInteger(targetPerPersonFen) ||
    targetPerPersonFen < 0 ||
    targetPerPersonFen > 10_000_000
  ) {
    throw new Error("预算目标金额无效。");
  }
  if (typeof estimate.includeIntercity !== "boolean") {
    throw new Error("请选择是否计入跨城往返费用。");
  }
  const categoryTotals = {} as BudgetSummary["categoryTotals"];
  const missing: BudgetCategory[] = [];
  let knownTotalFen = 0;
  for (const category of budgetCategories) {
    const entry = estimate.items[category];
    if (!entry || (entry.basis !== "per_person" && entry.basis !== "trip")) {
      throw new Error("费用口径无效。");
    }
    if (
      entry.amountFen !== null &&
      (!Number.isSafeInteger(entry.amountFen) ||
        entry.amountFen < 0 ||
        entry.amountFen > 10_000_000)
    ) {
      throw new Error("每项费用须为不超过十万元的非负金额，最多两位小数。");
    }
    if (entry.amountFen === null && entry.source !== null) {
      throw new Error("未知费用不能标注为已有估算。");
    }
    if (
      entry.amountFen !== null &&
      (entry.source?.kind !== "user" ||
        !/^\d{4}-\d{2}-\d{2}T/.test(entry.source.recordedAt) ||
        !Number.isFinite(Date.parse(entry.source.recordedAt)))
    ) {
      throw new Error("费用须标注手动估算来源与记录时间。");
    }
    if (category === "intercity" && !estimate.includeIntercity) {
      categoryTotals[category] = null;
      continue;
    }
    if (entry.amountFen === null) {
      categoryTotals[category] = null;
      missing.push(category);
      continue;
    }
    const total = entry.amountFen * (entry.basis === "per_person" ? travelers : 1);
    categoryTotals[category] = total;
    knownTotalFen += total;
  }
  const targetTotalFen = targetPerPersonFen * travelers;
  const complete = missing.length === 0;
  return {
    targetTotalFen,
    knownTotalFen,
    perPersonCeilingFen: Math.ceil(knownTotalFen / travelers),
    missing,
    complete,
    status:
      knownTotalFen > targetTotalFen ? "over" : complete ? "within_estimate" : "unknown",
    categoryTotals,
  };
}
