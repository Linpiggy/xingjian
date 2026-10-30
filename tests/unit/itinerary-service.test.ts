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
import { fixtureSocialInspiration } from "../fixtures/social";

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
  it("automatically provides reviewed catalog context to the model while keeping the requested brief unchanged", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    const references = fixtureSocialInspiration();
    const source = {
      load: vi.fn(async () => ({ status: "available" as const, references })),
    };
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal, vi.fn(), source);
    expect(source.load).toHaveBeenCalledOnce();
    expect(model.compose).toHaveBeenCalledOnce();
    expect(vi.mocked(model.compose).mock.calls[0][0].socialInspiration).toEqual(
      references,
    );
    expect(plan.brief).toEqual(brief);
    expect(plan.brief.socialInspiration).toBeUndefined();
    expect(plan.socialSource).toEqual({ status: "available", references });
    expect(plan.notices.join()).toContain("后台检索");
    expect(plan.constraints).toEqual([]);
  });
  it.each(["not_configured", "no_results", "unavailable"] as const)(
    "does not pretend %s social material was used or trigger a second model call",
    async (status) => {
      const { provider, model } = dependencies();
      const brief = fixtureBrief();
      const source = { load: vi.fn(async () => ({ status })) };
      const plan = await (
        await service()
      )(brief, provider, model, new AbortController().signal, vi.fn(), source);
      expect(model.compose).toHaveBeenCalledOnce();
      expect(vi.mocked(model.compose).mock.calls[0][0].socialInspiration).toBeUndefined();
      expect(plan.brief).toEqual(brief);
      expect(plan.socialSource).toEqual({ status });
    },
  );
  it("preserves explicitly chosen notes rather than silently replacing them with automatic sources", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.socialInspiration = fixtureSocialInspiration();
    const source = { load: vi.fn() };
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal, vi.fn(), source);
    expect(source.load).not.toHaveBeenCalled();
    expect(plan.brief).toEqual(brief);
    expect(plan.socialSource).toBeUndefined();
  });
  it("refuses a cross-city catalog result before sending any of its excerpts to the model", async () => {
    const { provider, model } = dependencies();
    const references = fixtureSocialInspiration();
    references.city = "错误城市";
    const source = {
      load: vi.fn(async () => ({ status: "available" as const, references })),
    };
    const plan = await (
      await service()
    )(fixtureBrief(), provider, model, new AbortController().signal, vi.fn(), source);
    expect(vi.mocked(model.compose).mock.calls[0][0].socialInspiration).toBeUndefined();
    expect(plan.socialSource).toEqual({ status: "unavailable" });
  });
  it("searches reviewed social places once across notes without adding hard requirements or model calls", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.socialInspiration = fixtureSocialInspiration();
    brief.socialInspiration.notes.push({
      ...structuredClone(brief.socialInspiration.notes[0]),
      noteId: "000000000000000000000002",
    });
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal);
    for (const name of ["测试文化场馆1", "测试午餐店"]) {
      expect(
        vi.mocked(provider.search).mock.calls.filter((call) => call[1] === name),
      ).toHaveLength(1);
    }
    expect(model.compose).toHaveBeenCalledOnce();
    expect(provider.walking).toHaveBeenCalledTimes(8);
    expect(plan.constraints).toEqual([]);
    expect(plan.notices.join(" ")).toContain("未核实的旅行经验");
    expect(plan.brief.socialInspiration).toEqual(brief.socialInspiration);
  });
  it("does not pass ambiguous social branches into the candidate pool or pretend a recommendation was required", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.socialInspiration = fixtureSocialInspiration();
    brief.socialInspiration.notes[0].places = [{ kind: "visit", name: "同名地点" }];
    const normal = vi.mocked(provider.search).getMockImplementation()!;
    const base = fixtureCandidates()[0].place;
    vi.mocked(provider.search).mockImplementation(async (...args) =>
      args[1] === "同名地点"
        ? [1, 2].map((index) => ({
            ...base,
            name: "同名地点",
            id: `ambiguous-social-${index}`,
          }))
        : normal(...args),
    );
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal);
    expect(plan.notices.join(" ")).toContain("未匹配唯一公共地点");
    expect(JSON.stringify(vi.mocked(model.compose).mock.calls[0][1])).not.toContain(
      "ambiguous-social-",
    );
    expect(plan.constraints).toEqual([]);
    expect(model.compose).toHaveBeenCalledOnce();
  });
  it("keeps an optional failed social lookup explicit without leaking the failure or retrying a query", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.socialInspiration = fixtureSocialInspiration();
    brief.socialInspiration.notes[0].places = [{ kind: "visit", name: "检索失败地点" }];
    const normal = vi.mocked(provider.search).getMockImplementation()!;
    vi.mocked(provider.search).mockImplementation(async (...args) => {
      if (args[1] === "检索失败地点") {
        throw new Error("fixture-sensitive-upstream-detail");
      }
      return normal(...args);
    });
    const plan = await (
      await service()
    )(brief, provider, model, new AbortController().signal);
    expect(plan.notices.join(" ")).toContain("地点检索未完成");
    expect(JSON.stringify(plan)).not.toContain("fixture-sensitive-upstream-detail");
    expect(
      vi.mocked(provider.search).mock.calls.filter((call) => call[1] === "检索失败地点"),
    ).toHaveLength(1);
    expect(model.compose).toHaveBeenCalledOnce();
  });
  it("rejects unconsented and wrong-city references before any search, route or model attempt", async () => {
    for (const change of [{ consent: false }, { city: "另一城市" }]) {
      const { provider, model } = dependencies();
      const brief = {
        ...fixtureBrief(),
        socialInspiration: { ...fixtureSocialInspiration(), ...change },
      };
      await expect(
        (await service())(
          brief as unknown as ReturnType<typeof fixtureBrief>,
          provider,
          model,
          new AbortController().signal,
        ),
      ).rejects.toThrow();
      expect(provider.search).not.toHaveBeenCalled();
      expect(provider.walking).not.toHaveBeenCalled();
      expect(model.compose).not.toHaveBeenCalled();
    }
  });
  it("preserves cancellation rather than turning an aborted social lookup into a fallback model call", async () => {
    const { provider, model } = dependencies();
    const brief = fixtureBrief();
    brief.socialInspiration = fixtureSocialInspiration();
    const controller = new AbortController();
    vi.mocked(provider.search).mockImplementation(async () => {
      controller.abort();
      throw controller.signal.reason;
    });
    await expect(
      (await service())(brief, provider, model, controller.signal),
    ).rejects.toThrow();
    expect(model.compose).not.toHaveBeenCalled();
    expect(provider.walking).not.toHaveBeenCalled();
  });
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
    expect(plan.days[0].recommendations[1].guide?.experience).toContain("文化线索");
    expect(plan.days[0].recommendations[0].guide?.tips[0]).toContain("过敏原");
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
  it("keeps a valid schedule and explicitly marks missing optional guides without another model call", async () => {
    const { provider, model } = dependencies();
    const outline = fixtureOutline();
    delete outline.guides;
    vi.mocked(model.compose).mockResolvedValue(outline);
    const plan = await (
      await service()
    )(fixtureBrief(), provider, model, new AbortController().signal);
    expect(plan.days[0].schedule?.items).toHaveLength(5);
    expect(plan.days[0].notices.join("")).toContain("详细体验建议缺失");
    expect(plan.days[0].recommendations.every((item) => !item.guide)).toBe(true);
    expect(model.compose).toHaveBeenCalledOnce();
    expect(provider.walking).toHaveBeenCalledTimes(8);
  });
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
  it("reconciles valid duplicate visits without a second model request or duplicated itinerary", async () => {
    const { provider, model } = dependencies();
    const outline = fixtureOutline();
    delete outline.guides;
    outline.days[1].visits = [structuredClone(outline.days[0].visits[0])];
    vi.mocked(model.compose).mockResolvedValue(outline);
    const result = await (
      await service()
    )(fixtureBrief(), provider, model, new AbortController().signal);
    const ids = result.days.flatMap(
      (day) =>
        day.schedule?.items
          .filter((item) => item.activity.kind === "visit")
          .map((item) => item.activity.place.id) ?? [],
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(
      result.days.every((day) =>
        day.schedule?.items.some((item) => item.activity.kind === "visit"),
      ),
    ).toBe(true);
    expect(result.notices.join()).toContain("去除 1 处重复景点");
    expect(model.compose).toHaveBeenCalledOnce();
  });
  it("rejects invented and wrong-kind model selections before routing", async () => {
    for (const variant of ["invented", "wrong_kind"]) {
      vi.resetModules();
      const { provider, model } = dependencies();
      const outline = fixtureOutline();
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
