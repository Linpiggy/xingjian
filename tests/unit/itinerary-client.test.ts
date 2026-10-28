import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OpenAiItineraryModel } from "@/server/ai/itinerary-model";
import { requestItinerary } from "@/features/itinerary/request-itinerary";
import { useItineraryStore } from "@/features/itinerary/itinerary-store";
import { dayActivitySchema } from "@/lib/meal-contracts";
import {
  fixtureBrief,
  fixtureCandidates,
  fixtureOutline,
  fixtureItinerary,
} from "../fixtures/itinerary";

const config = {
  key: "fixture-model-secret",
  endpoint: new URL("https://api.deepseek.com/chat/completions"),
  model: "fixture-model",
};
function completion(content = JSON.stringify(fixtureOutline()), finish = "stop") {
  return Response.json({ choices: [{ finish_reason: finish, message: { content } }] });
}
function stream(events: unknown[]) {
  return new Response(events.map((event) => JSON.stringify(event)).join("\n"), {
    headers: { "Content-Type": "application/x-ndjson" },
  });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});
describe("complete itinerary model boundary", () => {
  it("uses bounded JSON mode without raw queries, provider payloads, keys or private points", async () => {
    const candidates = fixtureCandidates();
    const privatePoint = structuredClone(candidates[0]);
    privatePoint.place.source = {
      ...privatePoint.place.source,
      kind: "user",
      provider: "user",
    };
    privatePoint.place.name = "fixture-private-home";
    candidates[0].query = "fixture-private-raw-query";
    const transport = vi.fn<typeof fetch>().mockResolvedValue(completion());
    await new OpenAiItineraryModel(config, transport).compose(
      fixtureBrief(),
      [...candidates, privatePoint],
      new AbortController().signal,
    );
    const options = transport.mock.calls[0][1]!;
    const body = String(options.body);
    expect(body).not.toContain(config.key);
    expect(body).not.toContain("fixture-private-home");
    expect(body).not.toContain("fixture-private-raw-query");
    expect(body).not.toContain("coordinateSystem");
    expect(JSON.parse(body).max_tokens).toBe(12000);
    expect(JSON.parse(body).thinking.type).toBe("disabled");
    expect(options.redirect).toBe("error");
    expect(options.cache).toBe("no-store");
  });
  it("binds required public venue IDs even when a candidate was discovered by another query", async () => {
    const brief = fixtureBrief();
    brief.mustVisit = ["测试文化场馆1"];
    brief.mustEat = [
      { kind: "restaurant", name: "测试午餐店" },
      { kind: "dish", name: "测试菜品" },
    ];
    const transport = vi.fn<typeof fetch>().mockResolvedValue(completion());
    await new OpenAiItineraryModel(config, transport).compose(
      brief,
      fixtureCandidates(),
      new AbortController().signal,
    );
    const payload = JSON.parse(
      JSON.parse(String(transport.mock.calls[0][1]!.body)).messages[1].content,
    );
    expect(payload.mustVisitIds).toEqual(["full-visit-0"]);
    expect(payload.mustRestaurantIds).toEqual(["full-food-1"]);
    expect(payload.mustEatDishes).toEqual(["测试菜品"]);
    expect(payload.mustVisit).toBeUndefined();
    expect(payload.mustEat).toBeUndefined();
  });
  it("rejects malformed, truncated, oversized and credential-containing model responses", async () => {
    for (const [response, code] of [
      [completion("bad JSON"), "ai_invalid_json"],
      [completion("{}"), "ai_invalid_response"],
      [completion(JSON.stringify(fixtureOutline()), "length"), "ai_output_truncated"],
      [completion(config.key), "ai_invalid_response"],
      [new Response("x".repeat(128001)), "ai_invalid_response"],
    ] as const) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        new OpenAiItineraryModel(config, transport).compose(
          fixtureBrief(),
          fixtureCandidates(),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code });
    }
  });
  it("does not reflect raw HTTP errors or retry charged model requests", async () => {
    for (const status of [401, 402, 429, 500]) {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("fixture-private-upstream", { status }));
      await expect(
        new OpenAiItineraryModel(config, transport).compose(
          fixtureBrief(),
          fixtureCandidates(),
          new AbortController().signal,
        ),
      ).rejects.not.toThrow("fixture-private-upstream");
      expect(transport).toHaveBeenCalledOnce();
    }
  });
  it("keeps AI-created meals unknown and cannot mark prices or dietary checks as user facts", () => {
    const meal = fixtureItinerary().days[0].schedule!.items[0].activity;
    expect(meal.meal?.source.kind).toBe("unverified");
    expect(dayActivitySchema.safeParse(meal).success).toBe(true);
    for (const change of [{ perPersonFen: 0 }, { dietaryCheck: "user_checked" }]) {
      expect(
        dayActivitySchema.safeParse({ ...meal, meal: { ...meal.meal, ...change } })
          .success,
      ).toBe(false);
    }
  });
});

describe("streamed planning client", () => {
  it("accepts UTF-8 split across network chunks and waits for a valid full result", async () => {
    const bytes = new TextEncoder().encode(
      `${JSON.stringify({ type: "progress", message: "正在核对三餐" })}\n${JSON.stringify({ type: "result", plan: fixtureItinerary() })}`,
    );
    const response = new Response(
      new ReadableStream({
        start(controller) {
          for (let i = 0; i < bytes.length; i += 17) {
            controller.enqueue(bytes.slice(i, i + 17));
          }
          controller.close();
        },
      }),
    );
    const progress = vi.fn();
    const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
    const plan = await requestItinerary(
      fixtureBrief(),
      new AbortController().signal,
      progress,
      transport,
    );
    expect(plan.brief.dayCount).toBe(2);
    expect(progress).toHaveBeenCalledWith("正在核对三餐");
    expect(transport).toHaveBeenCalledOnce();
  });
  it("rejects an incomplete stream instead of treating HTTP 200 as success", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(stream([{ type: "progress", message: "正在规划" }]));
    await expect(
      requestItinerary(fixtureBrief(), new AbortController().signal, vi.fn(), transport),
    ).rejects.toThrow("未完成");
  });
  it("rejects an old request result, a duplicate final result and arbitrary photo URLs", async () => {
    const old = fixtureItinerary();
    old.brief.travelers = 1;
    old.allocation[3].targetFen = old.brief.budget.amountFen;
    for (const events of [
      [{ type: "result", plan: old }],
      [
        { type: "result", plan: fixtureItinerary() },
        { type: "result", plan: fixtureItinerary() },
      ],
      [
        {
          type: "result",
          plan: { ...fixtureItinerary(), photoUrl: "https://example.invalid/photo.jpg" },
        },
      ],
    ]) {
      await expect(
        requestItinerary(
          fixtureBrief(),
          new AbortController().signal,
          vi.fn(),
          vi.fn<typeof fetch>().mockResolvedValue(stream(events)),
        ),
      ).rejects.toThrow();
    }
  });
  it("surfaces explicit service errors without a synthetic itinerary fallback", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        stream([
          { type: "error", code: "rate_limited", message: "AI 请求较多，请稍后重试。" },
        ]),
      );
    await expect(
      requestItinerary(fixtureBrief(), new AbortController().signal, vi.fn(), transport),
    ).rejects.toThrow("AI 请求较多");
    expect(transport).toHaveBeenCalledOnce();
  });
  it("sanitizes malformed JSON and bounds response bytes", async () => {
    for (const response of [
      new Response("fixture-private-malformed"),
      new Response("x".repeat(2_000_001)),
    ]) {
      await expect(
        requestItinerary(
          fixtureBrief(),
          new AbortController().signal,
          vi.fn(),
          vi.fn<typeof fetch>().mockResolvedValue(response),
        ),
      ).rejects.not.toThrow("fixture-private-malformed");
    }
  });
  it("ignores an already cancelled result and does not emit progress", async () => {
    const cancel = new AbortController();
    cancel.abort();
    const progress = vi.fn();
    await expect(
      requestItinerary(
        fixtureBrief(),
        cancel.signal,
        progress,
        vi
          .fn<typeof fetch>()
          .mockResolvedValue(stream([{ type: "result", plan: fixtureItinerary() }])),
      ),
    ).rejects.toBeDefined();
    expect(progress).not.toHaveBeenCalled();
  });
});

describe("ephemeral full-plan previews and versions", () => {
  beforeEach(() =>
    useItineraryStore.setState({ plan: null, review: null, previous: null, version: 0 }),
  );
  it("previews without overwriting, confirms once and undoes into a new local version", () => {
    const state = () => useItineraryStore.getState();
    const first = fixtureItinerary();
    const second = fixtureItinerary();
    second.title = "新的文化路线";
    state().receive(first, 0);
    expect(state().version).toBe(1);
    state().receive(second, 1);
    expect(state().plan?.title).toBe(first.title);
    expect(state().review?.plan.title).toBe(second.title);
    state().confirm();
    expect(state().plan?.title).toBe(second.title);
    expect(state().version).toBe(2);
    expect(() => state().confirm()).toThrow();
    state().undo();
    expect(state().plan?.title).toBe(first.title);
    expect(state().version).toBe(3);
    expect(() => state().undo()).toThrow();
  });
  it("rejects stale responses and stale confirmation without trusting rendered data", () => {
    const state = () => useItineraryStore.getState();
    state().receive(fixtureItinerary(), 0);
    expect(() => state().receive(fixtureItinerary(), 0)).toThrow("已变化");
    state().receive(fixtureItinerary(), 1);
    useItineraryStore.setState({ version: 2 });
    expect(() => state().confirm()).toThrow("已变化");
    expect(state().version).toBe(2);
  });
  it("cancels a proposal without changing the current plan or version", () => {
    const state = () => useItineraryStore.getState();
    state().receive(fixtureItinerary(), 0);
    const current = state().plan;
    state().receive(fixtureItinerary(), 1);
    state().cancelReview();
    expect(state().plan).toBe(current);
    expect(state().version).toBe(1);
    expect(state().review).toBeNull();
  });
});
