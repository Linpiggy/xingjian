import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import type { ItineraryProvider } from "@/server/services/create-itinerary";
import type { ItineraryModel } from "@/server/ai/itinerary-model";
import { itinerarySchema } from "@/lib/itinerary-contracts";
import {
  fixtureBrief,
  fixtureCandidates,
  fixtureOutline,
  fixtureItinerary,
} from "../fixtures/itinerary";
import { route } from "../fixtures/draft";

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.restoreAllMocks();
});
function dependencies() {
  const candidates = fixtureCandidates();
  const provider: ItineraryProvider = {
    search: vi.fn(async (_city, query) =>
      candidates
        .filter((candidate) =>
          query.includes("餐") || query.includes("菜")
            ? candidate.kind === "restaurant"
            : candidate.kind === "visit",
        )
        .map((candidate) => structuredClone(candidate.place)),
    ),
    walking: vi.fn(async () => structuredClone(route)),
  };
  const model: ItineraryModel = {
    model: "fixture-model",
    compose: vi.fn(async (brief) => fixtureOutline(brief)),
  };
  return { provider, model };
}
async function service() {
  return (await import("@/server/services/create-itinerary")).createItinerary;
}
describe("complete itinerary orchestration, offline only", () => {
  it("generates without must lists, includes three meals and queries only true directed neighbours", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal);
    expect(plan.days).toHaveLength(2);
    for (const day of plan.days) {
      expect(day.schedule?.items.map((item) => item.activity.kind)).toEqual([
        "breakfast",
        "visit",
        "lunch",
        "visit",
        "dinner",
      ]);
      expect(day.schedule?.status).toBe("unverified");
      expect(day.schedule?.items[0].startMinute).toBe(540);
      expect(day.schedule?.items[1].startMinute).toBe(615);
    }
    expect(provider.walking).toHaveBeenCalledTimes(8);
    expect(provider.walking).toHaveBeenNthCalledWith(
      1,
      [120.11, 30.2],
      [120.1, 30.2],
      expect.any(AbortSignal),
    );
    expect(model.compose).toHaveBeenCalledOnce();
    expect(plan.allocation.reduce((sum, item) => sum + item.targetFen, 0)).toBe(300000);
    expect(plan.fixture).toBe(true);
    expect(plan.status).toBe("unverified");
    expect(itinerarySchema.safeParse(plan).success).toBe(true);
  });
  it.each([
    [1, 1],
    [14, 20],
  ])(
    "supports %i days and %i travelers through scheduling and budget",
    async (days, travelers) => {
      const { provider, model } = dependencies();
      const brief = fixtureBrief();
      brief.dayCount = days;
      brief.travelers = travelers;
      brief.startDate = "2026-12-31";
      const plan = await (
        await service()
      )(brief, provider, model, new AbortController().signal);
      expect(plan.days).toHaveLength(days);
      expect(plan.days.at(-1)?.date).toBe(days === 14 ? "2027-01-13" : "2026-12-31");
      expect(provider.walking).toHaveBeenCalledTimes(days * 4);
      expect(plan.allocation.reduce((sum, value) => sum + value.targetFen, 0)).toBe(
        brief.budget.amountFen * travelers,
      );
      expect(plan.days.every((day) => day.schedule?.items.length === 5)).toBe(true);
    },
  );
  it("preserves a no-activity arrival date without fabricating meals or activity times", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.availability.firstDayStartMinute = 1380;
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal);
    expect(plan.days[0].schedule).toBeNull();
    expect(plan.days[0].notices.join("")).toContain("没有可游玩时段");
    expect(plan.days[1].schedule?.items).toHaveLength(5);
    expect(provider.walking).toHaveBeenCalledTimes(4);
  });
  it("limits meals to actual availability and does not invent breakfast after a late start", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.dayCount = 1;
    brief.availability.firstDayStartMinute = 720;
    brief.availability.lastDayEndMinute = 1020;
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal);
    expect(plan.days[0].schedule?.items.map((item) => item.activity.kind)).toEqual([
      "visit",
      "lunch",
      "visit",
    ]);
    expect(plan.days[0].notices.join("")).toContain("早餐未纳入");
    expect(
      plan.days[0].schedule?.items.every(
        (item) => item.startMinute === null || item.startMinute >= 720,
      ),
    ).toBe(true);
  });
  it("keeps unknown route timing null, queries no synthetic straight-line replacement", async () => {
    const { provider, model } = dependencies();
    vi.mocked(provider.walking).mockRejectedValue(new Error("fixture failure"));
    const plan = await (
      await service()
    )(fixtureBrief(), provider, model, new AbortController().signal);
    expect(plan.days[0].schedule?.items[0].startMinute).toBe(540);
    expect(
      plan.days[0].schedule?.items
        .slice(1)
        .every((item) => item.startMinute === null && item.endMinute === null),
    ).toBe(true);
    expect(plan.days[0].schedule?.legs.every((leg) => leg.route === null)).toBe(true);
    expect(provider.walking).toHaveBeenCalledTimes(8);
  });
  it("reports omitted hard requirements instead of declaring completion", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.mustVisit = ["测试文化场馆42"];
    brief.mustEat = [
      { kind: "restaurant", name: "测试午餐店" },
      { kind: "dish", name: "花生" },
    ];
    brief.dietary.allergies = ["花生"];
    vi.mocked(provider.search).mockImplementation(async (_city, query) =>
      fixtureCandidates()
        .filter(
          (candidate) =>
            query === candidate.place.name ||
            (query.includes("餐")
              ? candidate.kind === "restaurant"
              : candidate.kind === "visit"),
        )
        .map((candidate) => candidate.place),
    );
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal);
    expect(
      plan.constraints.find((item) => item.label === "必去：测试文化场馆42")?.status,
    ).toBe("conflict");
    expect(
      plan.constraints.find((item) => item.label === "必吃：测试午餐店")?.status,
    ).toBe("unverified");
    expect(plan.constraints.find((item) => item.label === "饮食冲突：花生")?.status).toBe(
      "conflict",
    );
    expect(plan.status).toBe("infeasible");
  });
  it("fails ambiguous mandatory POIs before calling the model", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.mustVisit = ["某场馆"];
    await expect(
      (await service())(brief, provider, model, new AbortController().signal),
    ).rejects.toThrow("未获得唯一匹配");
    expect(model.compose).not.toHaveBeenCalled();
  });
  it("rejects duplicate, invented and wrong-kind model selections before routing", async () => {
    for (const variant of ["duplicate", "invented", "wrong_kind"]) {
      vi.resetModules();
      const { provider, model } = dependencies();
      const outline = fixtureOutline();
      if (variant === "duplicate") {
        outline.days[1].visits[0].placeId = outline.days[0].visits[0].placeId;
      }
      if (variant === "invented") {
        outline.days[0].visits[0].placeId = "not-in-candidates";
      }
      if (variant === "wrong_kind") {
        outline.days[0].lunch.placeId = "full-visit-0";
      }
      vi.mocked(model.compose).mockResolvedValue(outline);
      await expect(
        (await service())(fixtureBrief(), provider, model, new AbortController().signal),
      ).rejects.toMatchObject({ code: "ai_invalid_response" });
      expect(provider.walking).not.toHaveBeenCalled();
    }
  });
  it("does not feed private user points into AI candidates", async () => {
    const { provider, model } = dependencies();
    const privatePoint = structuredClone(fixtureCandidates()[0].place);
    privatePoint.id = "user:private-home";
    privatePoint.name = "private-home-not-for-model";
    privatePoint.source = { ...privatePoint.source, kind: "user", provider: "user" };
    const original = provider.search;
    provider.search = vi.fn(async (...args: Parameters<ItineraryProvider["search"]>) => [
      ...(await original(...args)),
      privatePoint,
    ]);
    await (
      await service()
    )(fixtureBrief(), provider, model, new AbortController().signal);
    expect(JSON.stringify(vi.mocked(model.compose).mock.calls[0][1])).not.toContain(
      "private-home-not-for-model",
    );
  });
  it("aborts before querying or accepting late results", async () => {
    const { provider, model } = dependencies();
    const abort = new AbortController();
    abort.abort();
    await expect(
      (await service())(fixtureBrief(), provider, model, abort.signal),
    ).rejects.toBeDefined();
    expect(provider.search).not.toHaveBeenCalled();
    expect(model.compose).not.toHaveBeenCalled();
  });
  it("keeps zero and leftover-fen targets exact, with excluded costs at zero allocation only", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.budget = {
      amountFen: 110,
      basis: "total",
      includeIntercity: false,
      includeLodging: false,
    };
    brief.travelers = 3;
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal);
    expect(plan.allocation.reduce((sum, item) => sum + item.targetFen, 0)).toBe(110);
    expect(
      plan.allocation
        .filter((item) => ["intercity", "lodging"].includes(item.category))
        .every((item) => item.targetFen === 0),
    ).toBe(true);
    expect(
      plan.days
        .flatMap((day) => day.schedule?.items ?? [])
        .filter((item) => item.activity.meal)
        .every((item) => item.activity.meal!.perPersonFen === null),
    ).toBe(true);
  });
  it("bounds geometry by dropping complete excess segments, never joins missing paths", async () => {
    const { provider, model } = dependencies();
    const long = structuredClone(route);
    long.segments = [
      Array.from({ length: 400 }, () => [120.1, 30.2] as [number, number]),
      Array.from({ length: 200 }, () => [120.11, 30.21] as [number, number]),
    ];
    vi.mocked(provider.walking).mockResolvedValue(long);
    const plan = await (
      await service()
    )(fixtureBrief(), provider, model, new AbortController().signal);
    expect(plan.days[0].schedule?.legs[0].route?.segments).toEqual([long.segments[0]]);
    expect(plan.days[0].notices.join("")).toContain("不虚接");
  });
});

describe("full proposal response integrity", () => {
  it("validates dates, allocation totals, fixture attribution and actual neighbours", () => {
    const valid = fixtureItinerary();
    expect(itinerarySchema.safeParse(valid).success).toBe(true);
    for (const mutate of [
      (plan: typeof valid) => {
        plan.days[0].date = "2026-11-02";
      },
      (plan: typeof valid) => {
        plan.allocation[0].targetFen += 1;
      },
      (plan: typeof valid) => {
        plan.fixture = false;
      },
      (plan: typeof valid) => {
        plan.days[0].schedule!.legs[0].toActivityId = "activity:wrong";
      },
    ]) {
      const invalid = structuredClone(valid);
      mutate(invalid);
      expect(itinerarySchema.safeParse(invalid).success).toBe(false);
    }
  });
});
