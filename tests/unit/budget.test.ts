import { describe, expect, it } from "vitest";
import {
  budgetCategories,
  emptyBudget,
  summarizeBudget,
  type BudgetEstimate,
  type ExpenseEstimate,
} from "@/domain/budget";
import { budgetEstimateSchema } from "@/lib/contracts";
import {
  commitBudget,
  commitEdit,
  createEditState,
  previewBudget,
  previewEdit,
  resolveEdit,
  undoEdit,
} from "@/domain/editing";
import { fixtureDraft, places, route } from "../fixtures/draft";

const source = { kind: "user" as const, recordedAt: "2026-10-14T00:00:00.000Z" };
const entry = (
  amountFen: number,
  basis: ExpenseEstimate["basis"] = "per_person",
): ExpenseEstimate => ({ amountFen, basis, source });
function complete(): BudgetEstimate {
  return {
    includeIntercity: true,
    items: {
      intercity: entry(40000),
      local: entry(5000),
      lodging: entry(60000, "trip"),
      meals: entry(25000),
      tickets: entry(10000),
    },
  };
}

describe("integer-fen, all-category manual estimates (not provider prices)", () => {
  it("keeps missing fees null and does not certify an empty budget as within target", () => {
    const budget = emptyBudget();
    const summary = summarizeBudget(budget, 2, 150000);
    expect(summary.status).toBe("unknown");
    expect(summary.complete).toBe(false);
    expect(summary.missing).toEqual([...budgetCategories]);
    expect(Object.values(summary.categoryTotals)).toEqual([null, null, null, null, null]);
    expect(budget.items.lodging.source).toBeNull();
  });

  it("multiplies per-person costs once, not the whole-party lodging total", () => {
    const summary = summarizeBudget(complete(), 2, 150000);
    expect(summary.knownTotalFen).toBe(220000);
    expect(summary.perPersonCeilingFen).toBe(110000);
    expect(summary.targetTotalFen).toBe(300000);
    expect(summary.categoryTotals.lodging).toBe(60000);
    expect(summary.status).toBe("within_estimate");
    expect(summary.complete).toBe(true);
  });

  it("can report already-over-budget with other prices still unknown", () => {
    const budget = emptyBudget();
    budget.items.intercity = entry(200000);
    const summary = summarizeBudget(budget, 2, 150000);
    expect(summary.status).toBe("over");
    expect(summary.complete).toBe(false);
    expect(summary.missing).toHaveLength(4);
  });

  it("excludes cross-city fees explicitly without losing their entered value", () => {
    const budget = complete();
    budget.includeIntercity = false;
    const summary = summarizeBudget(budget, 2, 150000);
    expect(summary.knownTotalFen).toBe(140000);
    expect(summary.categoryTotals.intercity).toBeNull();
    expect(budget.items.intercity.amountFen).toBe(40000);
    expect(summary.missing).not.toContain("intercity");
    expect(summary.complete).toBe(true);
  });

  it("treats only explicit sourced zero as a zero estimate and rounds displayed splits up", () => {
    const budget = emptyBudget();
    for (const category of budgetCategories) {
      budget.items[category] = entry(0);
    }
    budget.items.lodging = entry(10001, "trip");
    const summary = summarizeBudget(budget, 3, 5000);
    expect(summary.knownTotalFen).toBe(10001);
    expect(summary.perPersonCeilingFen).toBe(3334);
    expect(summary.complete).toBe(true);
    expect(summary.status).toBe("within_estimate");
  });

  it.each([
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    10000001,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects invalid fen %s", (amount) => {
    const budget = emptyBudget();
    budget.items.local = entry(amount);
    expect(() => summarizeBudget(budget, 2, 150000)).toThrow("每项费用");
    expect(budgetEstimateSchema.safeParse(budget).success).toBe(false);
  });

  it.each([0, 9, 1.5])("rejects invalid traveler count %s", (travelers) => {
    expect(() => summarizeBudget(complete(), travelers, 150000)).toThrow("同行人数");
  });

  it("requires source metadata and rejects a source attached to an unknown amount", () => {
    const budget = emptyBudget();
    budget.items.local = { amountFen: 110, basis: "per_person", source: null };
    expect(() => summarizeBudget(budget, 2, 150000)).toThrow("来源");
    expect(budgetEstimateSchema.safeParse(budget).success).toBe(false);
    budget.items.local = { amountFen: null, basis: "per_person", source };
    expect(() => summarizeBudget(budget, 2, 150000)).toThrow("未知费用");
    budget.items.local = entry(110);
    expect(summarizeBudget(budget, 2, 150000).knownTotalFen).toBe(220);
  });

  it("shares preview/confirm/undo versions with route edits, never mutating the draft", () => {
    const state = createEditState(fixtureDraft(), "budget-fixture");
    const before = structuredClone(state);
    const edit = resolveEdit(
      state,
      previewEdit(state, {
        placeId: places[0].id,
        toDay: 0,
        toIndex: 1,
        stayMinutes: 90,
      }),
      [route],
    );
    const proposal = previewBudget(state, complete());
    expect(state).toEqual(before);
    const next = commitBudget(state, proposal);
    expect(next.version).toBe(1);
    expect(next.draft).toBe(state.draft);
    expect(() => commitEdit(next, edit)).toThrow("行程已变化");
    expect(() => commitBudget(next, proposal)).toThrow("重新预览费用");
    const undone = undoEdit(next);
    expect(undone.version).toBe(2);
    expect(undone.budget).toEqual(emptyBudget());
    expect(undone.previous).toBeNull();
  });
});
