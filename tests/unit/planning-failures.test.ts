import { describe, expect, it, vi } from "vitest";
import { OpenAiItineraryModel } from "@/server/ai/itinerary-model";
import { requestItinerary } from "@/features/itinerary/request-itinerary";
import { fixtureBrief, fixtureCandidates, fixtureOutline } from "../fixtures/itinerary";

const config = {
  key: "fixture-model-secret",
  endpoint: new URL("https://api.deepseek.com/chat/completions"),
  model: "fixture-model",
};

describe("generation failure regressions, offline only", () => {
  it("does not charge the AI attempt budget when candidate discovery fails before the model", async () => {
    vi.resetModules();
    const { createItinerary } = await import("@/server/services/create-itinerary");
    const provider = { search: vi.fn(async () => []), walking: vi.fn() };
    const model = { model: "fixture-model", compose: vi.fn() };
    for (let index = 0; index < 4; index++) {
      await expect(
        createItinerary(fixtureBrief(), provider, model, new AbortController().signal),
      ).rejects.toMatchObject({ code: "no_place" });
    }
    expect(model.compose).not.toHaveBeenCalled();
  });
  it.each(["missing", "partial"])(
    "retains a valid core itinerary when optional guidance is %s",
    async (variant) => {
      const outline = fixtureOutline();
      if (variant === "missing") {
        delete outline.guides;
      } else {
        outline.guides!.pop();
      }
      const transport = vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          choices: [
            { finish_reason: "stop", message: { content: JSON.stringify(outline) } },
          ],
        }),
      );
      await expect(
        new OpenAiItineraryModel(config, transport).compose(
          fixtureBrief(),
          fixtureCandidates(),
          new AbortController().signal,
        ),
      ).resolves.toMatchObject({ days: outline.days });
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it("distinguishes a truncated output from a schema failure without retrying", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [{ finish_reason: "length", message: { content: '{"days":[' } }],
      }),
    );
    await expect(
      new OpenAiItineraryModel(config, transport).compose(
        fixtureBrief(),
        fixtureCandidates(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "ai_output_truncated" });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("distinguishes model permission errors without reflecting raw provider data", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("fixture-private-provider", { status: 401 }));
    await expect(
      new OpenAiItineraryModel(config, transport).compose(
        fixtureBrief(),
        fixtureCandidates(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "ai_permission_denied" });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("turns a non-JSON gateway failure into a useful bounded error", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response("<html>fixture-private-gateway</html>", { status: 503 }),
      );
    await expect(
      requestItinerary(fixtureBrief(), new AbortController().signal, vi.fn(), transport),
    ).rejects.toMatchObject({
      code: "service_unavailable",
      message: "规划服务暂不可用，请稍后重试；原方案保持不变。",
    });
  });

  it("preserves a safe error code and planning stage across the NDJSON boundary", async () => {
    const transport = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          type: "error",
          code: "ai_output_truncated",
          stage: "model",
          message: "AI 输出达到长度上限，未使用截断方案。",
        }) + "\n",
      ),
    );
    await expect(
      requestItinerary(fixtureBrief(), new AbortController().signal, vi.fn(), transport),
    ).rejects.toMatchObject({
      code: "ai_output_truncated",
      stage: "model",
      message: "AI 输出达到长度上限，未使用截断方案。",
    });
  });

  it("accepts one complete JSON fence but never extracts a fragment from prose", async () => {
    const outline = fixtureOutline();
    const response = (content: string) =>
      Response.json({ choices: [{ finish_reason: "stop", message: { content } }] });
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response("```json\n" + JSON.stringify(outline) + "\n```"));
    await expect(
      new OpenAiItineraryModel(config, transport).compose(
        fixtureBrief(),
        fixtureCandidates(),
        new AbortController().signal,
      ),
    ).resolves.toEqual(outline);
    const invalid = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response("explanation " + JSON.stringify(outline)));
    await expect(
      new OpenAiItineraryModel(config, invalid).compose(
        fixtureBrief(),
        fixtureCandidates(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "ai_invalid_json" });
    expect(transport).toHaveBeenCalledOnce();
    expect(invalid).toHaveBeenCalledOnce();
  });

  it("preserves bounded upstream cooldown metadata without retrying", async () => {
    const limited = new Response("fixture-private-provider", {
      status: 429,
      headers: { "Retry-After": "12" },
    });
    const transport = vi.fn<typeof fetch>().mockResolvedValue(limited);
    await expect(
      new OpenAiItineraryModel(config, transport).compose(
        fixtureBrief(),
        fixtureCandidates(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "ai_rate_limited", retryAfterSeconds: 12 });
    expect(transport).toHaveBeenCalledOnce();
  });

  it("does not expose raw network exceptions to a traveler", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fixture-private-network-detail"));
    await expect(
      requestItinerary(fixtureBrief(), new AbortController().signal, vi.fn(), transport),
    ).rejects.toMatchObject({
      code: "network_error",
      message: "规划连接中断，请检查网络后重试；原方案保持不变。",
    });
    expect(transport).toHaveBeenCalledOnce();
  });
});
