import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("actual AI attempts and pipeline concurrency", () => {
  it("counts model attempts only, including failed attempts, and releases the window without a retry", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const { withAiBudget } = await import("@/server/ai/budget");
    const call = vi.fn(async () => "ok");
    for (let index = 0; index < 3; index++) {
      await expect(withAiBudget(call)).resolves.toBe("ok");
    }
    await expect(withAiBudget(call)).rejects.toMatchObject({
      code: "ai_local_rate_limited",
      retryAfterSeconds: 60,
    });
    expect(call).toHaveBeenCalledTimes(3);
    vi.setSystemTime(new Date("2026-11-01T00:01:00.001Z"));
    await expect(withAiBudget(call)).resolves.toBe("ok");
    expect(call).toHaveBeenCalledTimes(4);
  });

  it("blocks duplicate pipeline work without counting it as another model attempt", async () => {
    vi.resetModules();
    const { withItineraryBudget, withAiBudget } = await import("@/server/ai/budget");
    let finish = () => {};
    const current = withItineraryBudget(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const duplicate = vi.fn(async () => {});
    await expect(withItineraryBudget(duplicate)).rejects.toMatchObject({
      code: "generation_busy",
    });
    expect(duplicate).not.toHaveBeenCalled();
    finish();
    await current;
    for (let index = 0; index < 3; index++) {
      await expect(withAiBudget(async () => "ok")).resolves.toBe("ok");
    }
  });

  it("honors an upstream cooldown before any new candidate search or model call", async () => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-01T00:00:00Z"));
    const { withAiBudget, withItineraryBudget } = await import("@/server/ai/budget");
    const { ProviderError } = await import("@/server/providers/errors");
    const call = vi.fn(async () => {
      throw new ProviderError("unavailable", "fixture", "ai_rate_limited", 10);
    });
    await expect(withAiBudget(call)).rejects.toMatchObject({ code: "ai_rate_limited" });
    const search = vi.fn(async () => "searched");
    await expect(withItineraryBudget(search)).rejects.toMatchObject({
      code: "ai_cooldown",
      retryAfterSeconds: 10,
    });
    await expect(withAiBudget(call)).rejects.toMatchObject({ code: "ai_cooldown" });
    expect(search).not.toHaveBeenCalled();
    expect(call).toHaveBeenCalledOnce();
    vi.setSystemTime(new Date("2026-11-01T00:00:10Z"));
    await expect(withItineraryBudget(search)).resolves.toBe("searched");
  });
});
