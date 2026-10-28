import { beforeEach, describe, expect, it } from "vitest";
import { budgetCategories, summarizeBudget } from "@/domain/budget";
import {
  emptyItineraryExpenses,
  summarizeItineraryExpenses,
} from "@/domain/itinerary-expenses";
import { changeItinerary } from "@/domain/itinerary-editing";
import {
  itineraryChangeSchema,
  itinerarySchema,
  itineraryExpensesSchema,
} from "@/lib/itinerary-contracts";
import { useItineraryStore } from "@/features/itinerary/itinerary-store";
import { fixtureBrief, fixtureItinerary } from "../fixtures/itinerary";

const source = { kind: "user" as const, recordedAt: "2026-10-28T01:00:00Z" };
const estimate = (amount = 10005) => {
  const value = emptyItineraryExpenses();
  value.items.meals = {
    amountFen: amount,
    basis: "per_person",
    source: structuredClone(source),
  };
  return value;
};
const state = () => useItineraryStore.getState();
beforeEach(() => {
  useItineraryStore.setState({ plan: null, review: null, previous: null, version: 0 });
});

describe("full itinerary expense estimates", () => {
  it.each([1, 20])(
    "uses %i travelers and mixed exact per-person / party totals without a legacy cap",
    (travelers) => {
      const brief = fixtureBrief();
      brief.travelers = travelers;
      const expenses = estimate();
      expenses.items.lodging = {
        amountFen: 25000,
        basis: "trip",
        source: structuredClone(source),
      };
      expenses.items.local = {
        amountFen: 0,
        basis: "per_person",
        source: structuredClone(source),
      };
      const summary = summarizeItineraryExpenses(brief, expenses);
      expect(summary.knownTotalFen).toBe(10005 * travelers + 25000);
      expect(summary.categoryTotals.local).toBe(0);
      expect(summary.categoryTotals.tickets).toBeNull();
      expect(summary.missing).toEqual(["tickets"]);
      expect(summary.status).toBe("unknown");
      expect(summary.complete).toBe(false);
    },
  );
  it("compares with the exact party target rather than rounded per-person multiplication", () => {
    const brief = fixtureBrief();
    brief.travelers = 3;
    brief.budget.basis = "total";
    brief.budget.amountFen = 110;
    const summary = summarizeItineraryExpenses(brief, emptyItineraryExpenses());
    expect(summary.targetTotalFen).toBe(110);
    expect(summary.knownTotalFen).toBe(0);
    expect(summary.status).toBe("unknown");
  });
  it("retains excluded records without counting them, including lodging, and never marks unknown as free", () => {
    const brief = fixtureBrief();
    brief.budget.includeLodging = false;
    const expenses = emptyItineraryExpenses();
    expenses.items.lodging = {
      amountFen: 50000,
      basis: "trip",
      source: structuredClone(source),
    };
    expenses.items.intercity = {
      amountFen: 50000,
      basis: "per_person",
      source: structuredClone(source),
    };
    const summary = summarizeItineraryExpenses(brief, expenses);
    expect(summary.knownTotalFen).toBe(0);
    expect(summary.missing).toEqual(["local", "meals", "tickets"]);
    expect(summary.categoryTotals.lodging).toBeNull();
    expect(expenses.items.lodging.amountFen).toBe(50000);
  });
  it("reports over-target known partial totals even with missing categories, without changing the target", () => {
    const brief = fixtureBrief();
    const summary = summarizeItineraryExpenses(brief, estimate(1_000_000));
    expect(summary.status).toBe("over");
    expect(summary.complete).toBe(false);
    expect(summary.targetTotalFen).toBe(300000);
  });
  it("complete explicit zeros remain manual estimates, not supplier quotes", () => {
    const expenses = emptyItineraryExpenses();
    for (const category of budgetCategories) {
      expenses.items[category] = {
        amountFen: 0,
        basis: "trip",
        source: structuredClone(source),
      };
    }
    const summary = summarizeItineraryExpenses(fixtureBrief(), expenses);
    expect(summary.status).toBe("within_estimate");
    expect(summary.complete).toBe(true);
    expect(summary.knownTotalFen).toBe(0);
    expect(itineraryExpensesSchema.safeParse(expenses).success).toBe(true);
  });
  it.each([-1, 0.5, 10_000_001, NaN])(
    "rejects invalid fen %s without truncation or zero conversion",
    (amount) => {
      const expenses = estimate(amount);
      expect(() => summarizeItineraryExpenses(fixtureBrief(), expenses)).toThrow();
      expect(itineraryExpensesSchema.safeParse(expenses).success).toBe(false);
    },
  );
  it("rejects missing provenance, timestamps or injected permissions and preserves the old eight-person boundary", () => {
    const missing = estimate();
    missing.items.meals.source = null;
    expect(() => summarizeItineraryExpenses(fixtureBrief(), missing)).toThrow("来源");
    expect(itineraryExpensesSchema.safeParse(missing).success).toBe(false);
    expect(
      itineraryChangeSchema.safeParse({
        kind: "expenses",
        expenses: estimate(),
        acknowledgeOver: false,
        includeLodging: true,
      }).success,
    ).toBe(false);
    expect(() =>
      summarizeBudget({ includeIntercity: true, ...estimate() }, 20, 150000),
    ).toThrow("1-8");
  });
  it("changes only estimates, preserving fourteen-day schedules, booking facts, locks and budget targets", () => {
    const brief = fixtureBrief();
    brief.dayCount = 14;
    brief.travelers = 20;
    const before = changeItinerary(fixtureItinerary(brief), {
      kind: "position_lock",
      activityId: "activity:trip-13-1",
      locked: true,
    });
    const copy = structuredClone(before);
    const after = changeItinerary(before, {
      kind: "expenses",
      expenses: estimate(),
      acknowledgeOver: false,
    });
    expect(before).toEqual(copy);
    expect(after.days).toEqual(before.days);
    expect(after.brief).toEqual(before.brief);
    expect(after.allocation).toEqual(before.allocation);
    expect(after.generatedAt).toBe(before.generatedAt);
    expect(after.expenses).toEqual(estimate());
    expect(itinerarySchema.safeParse(after).success).toBe(true);
  });
  it("requires explicit over-target acknowledgement and does not allow timestamp-only refreshes", () => {
    const before = fixtureItinerary();
    expect(() =>
      changeItinerary(before, {
        kind: "expenses",
        expenses: estimate(1_000_000),
        acknowledgeOver: false,
      }),
    ).toThrow("知情确认");
    const after = changeItinerary(before, {
      kind: "expenses",
      expenses: estimate(1_000_000),
      acknowledgeOver: true,
    });
    expect(after.brief).toEqual(before.brief);
    const same = structuredClone(after.expenses!);
    same.items.meals.source!.recordedAt = "2026-10-29T00:00:00Z";
    expect(() =>
      changeItinerary(after, { kind: "expenses", expenses: same, acknowledgeOver: true }),
    ).toThrow("没有变化");
  });
  it("keeps unchanged category clocks when another item changes, and allows explicitly clearing old records", () => {
    const before = changeItinerary(fixtureItinerary(), {
      kind: "expenses",
      expenses: estimate(),
      acknowledgeOver: false,
    });
    const next = structuredClone(before.expenses!);
    next.items.meals.source!.recordedAt = "2026-10-29T00:00:00Z";
    next.items.local = {
      amountFen: 100,
      basis: "trip",
      source: { ...source, recordedAt: "2026-10-29T00:00:00Z" },
    };
    const after = changeItinerary(before, {
      kind: "expenses",
      expenses: next,
      acknowledgeOver: false,
    });
    expect(after.expenses!.items.meals.source).toEqual(source);
    expect(after.expenses!.items.local.source!.recordedAt).toBe("2026-10-29T00:00:00Z");
    const cleared = changeItinerary(after, {
      kind: "expenses",
      expenses: emptyItineraryExpenses(),
      acknowledgeOver: false,
    });
    expect(cleared.expenses!.items.meals.amountFen).toBeNull();
    expect(cleared.expenses!.items.meals.source).toBeNull();
  });
});

describe("versioned expense proposals", () => {
  it("previews, cancels, confirms and undoes as new local versions without trusting a changed candidate", () => {
    state().receive(fixtureItinerary(), 0);
    const before = state().plan;
    state().proposeChange({
      kind: "expenses",
      expenses: estimate(),
      acknowledgeOver: false,
    });
    expect(state().plan).toBe(before);
    state().cancelReview();
    expect(state().version).toBe(1);
    state().proposeChange({
      kind: "expenses",
      expenses: estimate(),
      acknowledgeOver: false,
    });
    state().review!.plan.expenses!.items.meals.amountFen = 0;
    state().confirm();
    expect(state().plan!.expenses!.items.meals.amountFen).toBe(10005);
    expect(state().version).toBe(2);
    state().undo();
    expect(state().plan).toBe(before);
    expect(state().version).toBe(3);
  });
  it("rechecks over-target acknowledgement at confirmation and rejects stale estimates", () => {
    state().receive(fixtureItinerary(), 0);
    state().proposeChange({
      kind: "expenses",
      expenses: estimate(1_000_000),
      acknowledgeOver: true,
    });
    const change = state().review!.change;
    if (change?.kind !== "expenses") {
      throw new Error("missing cost proposal");
    }
    change.acknowledgeOver = false;
    expect(() => state().confirm()).toThrow("知情确认");
    useItineraryStore.setState({ version: 2 });
    expect(() => state().confirm()).toThrow("已变化");
    expect(state().plan!.expenses).toBeUndefined();
  });
});
