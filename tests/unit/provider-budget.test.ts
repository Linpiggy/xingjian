import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
});

describe("supplier budgets stay separate per credential", () => {
  it("does not let browser map traffic consume the server Web service window", async () => {
    const budget = await import("@/server/providers/budget");
    for (let index = 0; index < 60; index += 1) {
      await budget.withProviderBudget(async () => index);
    }
    await expect(budget.withProviderBudget(async () => "blocked")).rejects.toMatchObject({
      code: "rate_limited",
    });
    expect(budget.providerWaitMs()).toBeGreaterThan(0);
    // The same overload must not have spent the JS proxy window.
    expect(budget.mapProxyWaitMs()).toBe(0);
    for (let index = 0; index < 120; index += 1) {
      await budget.withMapProxyBudget(async () => index);
    }
    await expect(budget.withMapProxyBudget(async () => "blocked")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });

  it("keeps the server window available while the map SDK is bursting", async () => {
    const budget = await import("@/server/providers/budget");
    const bursts = Array.from({ length: 8 }, () =>
      budget.withMapProxyBudget(
        () => new Promise<string>((resolve) => setTimeout(() => resolve("map"), 5)),
      ),
    );
    await expect(budget.withMapProxyBudget(async () => "blocked")).rejects.toMatchObject({
      code: "rate_limited",
    });
    await expect(budget.withProviderBudget(async () => "plan")).resolves.toBe("plan");
    await Promise.all(bursts);
  });
});
