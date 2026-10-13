import { afterEach, describe, expect, it, vi } from "vitest";
import { modelConfig } from "@/server/ai/config";
import { OpenAiCompatibleModel } from "@/server/ai/openai-compatible";
import { places } from "../fixtures/draft";

const input = {
  city: "测试城市",
  dayCount: 2 as const,
  budgetPerPersonFen: 100000,
  interests: ["博物馆" as const],
};
const candidates = places.map((place) => ({
  place,
  selection: { kind: "amap" as const, poiId: place.id, keyword: "博物馆" },
}));
const choices = {
  recommendations: places
    .slice(0, 2)
    .map((place) => ({ placeId: place.id, reason: "AI 分析：与博物馆兴趣匹配" })),
};
function config() {
  return {
    key: "fixture-model-secret",
    endpoint: new URL("https://api.deepseek.com/chat/completions"),
    model: "fixture-model",
  };
}
function completion(content = JSON.stringify(choices), finish = "stop") {
  return Response.json({ choices: [{ finish_reason: finish, message: { content } }] });
}
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("OpenAI-compatible model (mock HTTP only)", () => {
  it("uses bounded JSON mode and keeps the key out of the prompt", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(completion());
    const result = await new OpenAiCompatibleModel(config(), transport).select(
      input,
      candidates,
    );
    expect(result).toHaveLength(2);
    const options = transport.mock.calls[0][1]!;
    const body = String(options.body);
    expect(body).not.toContain(config().key);
    expect(JSON.parse(body).max_tokens).toBe(1200);
    expect(JSON.parse(body).response_format.type).toBe("json_object");
    expect(JSON.parse(body).thinking.type).toBe("disabled");
    expect(options.redirect).toBe("error");
  });
  it("does not send user-created coordinates to the model", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(completion());
    await new OpenAiCompatibleModel(config(), transport).select(input, [
      ...candidates,
      {
        place: { ...places[0], name: "private-home-fixture" },
        selection: {
          kind: "user",
          id: "user:home",
          name: "private-home-fixture",
          location: [120, 30],
        },
      },
    ]);
    expect(String(transport.mock.calls[0][1]?.body)).not.toContain(
      "private-home-fixture",
    );
  });
  it("rejects malformed or truncated JSON instead of returning fake suggestions", async () => {
    for (const response of [
      completion("not json"),
      completion("{}"),
      completion(JSON.stringify(choices), "length"),
    ]) {
      const transport = vi.fn<typeof fetch>().mockResolvedValue(response);
      await expect(
        new OpenAiCompatibleModel(config(), transport).select(input, candidates),
      ).rejects.toMatchObject({ code: "ai_invalid_response" });
    }
  });
  it("maps auth, quota and HTTP failures without returning raw supplier text", async () => {
    for (const status of [401, 402, 429, 500]) {
      const transport = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response("fixture-private-raw-error", { status }));
      await expect(
        new OpenAiCompatibleModel(config(), transport).select(input, candidates),
      ).rejects.toMatchObject({
        code: status === 429 ? "rate_limited" : "ai_unavailable",
      });
    }
  });
  it("supports a configured v1-compatible endpoint", () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    vi.stubEnv("OPENAI_BASE_URL", "https://example.invalid/v1/");
    vi.stubEnv("OPENAI_MODEL", "fixture-model");
    expect(modelConfig().endpoint.href).toBe(
      "https://example.invalid/v1/chat/completions",
    );
  });
  it("rejects credential-bearing URLs and missing keys", () => {
    vi.stubEnv("OPENAI_API_KEY", "fixture-key");
    for (const url of [
      "http://evil.invalid",
      "https://user:pass@example.invalid",
      "https://example.invalid/?key=value",
    ]) {
      vi.stubEnv("OPENAI_BASE_URL", url);
      expect(() => modelConfig()).toThrow();
    }
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "");
    expect(() => modelConfig()).toThrow();
  });
  it("uses only candidate IDs and rejects AI-invented or duplicate places", async () => {
    for (const invalid of [
      [
        { placeId: "invented", reason: "fixture" },
        { placeId: places[0].id, reason: "fixture" },
      ],
      [
        { placeId: places[0].id, reason: "fixture" },
        { placeId: places[0].id, reason: "fixture" },
      ],
    ]) {
      vi.resetModules();
      const { recommendPlaces } = await import("@/server/services/recommend-places");
      const provider = { search: vi.fn(async () => places) };
      const ai = { model: "fixture", select: vi.fn(async () => invalid) };
      await expect(recommendPlaces(input, provider, ai)).rejects.toMatchObject({
        code: "ai_invalid_response",
      });
    }
  });
  it("returns public candidates with selection references, never generates routes", async () => {
    const { recommendPlaces } = await import("@/server/services/recommend-places");
    const provider = { search: vi.fn(async () => places) };
    const ai = { model: "fixture", select: vi.fn(async () => choices.recommendations) };
    const result = await recommendPlaces(input, provider, ai);
    expect(result.recommendations[0].selection).toEqual({
      kind: "amap",
      poiId: places[0].id,
      keyword: "博物馆",
    });
    expect(provider.search).toHaveBeenCalledOnce();
  });
});
