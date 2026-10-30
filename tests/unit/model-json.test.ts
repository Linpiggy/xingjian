import { afterEach, describe, expect, it, vi } from "vitest";
import { jsonFailureSummary } from "@/server/ai/model-json";
import { OpenAiItineraryModel } from "@/server/ai/itinerary-model";
import { fixtureBrief, fixtureCandidates } from "../fixtures/itinerary";

const config = {
  key: "fixture-secret-key",
  endpoint: new URL("https://fixture.invalid/chat/completions"),
  model: "fixture-model",
};
afterEach(() => vi.restoreAllMocks());
describe("model JSON failure boundaries", () => {
  it.each(["<html>private-provider-body</html>", 'data: {"private":"provider"}\n\n'])(
    "distinguishes invalid upstream envelope without leaking raw data: %s",
    async (body) => {
      const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
      const transport = vi
        .fn<typeof fetch>()
        .mockImplementation(async () => new Response(body));
      await expect(
        new OpenAiItineraryModel(config, transport).compose(
          fixtureBrief(),
          fixtureCandidates(),
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({ code: "ai_upstream_invalid_json" });
      expect(transport).toHaveBeenCalledOnce();
      expect(String(warning.mock.calls[0]?.[0])).toContain('"layer":"upstream"');
      expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
    },
  );
  it("does not mistake a valid JSON provider error object for invalid model JSON", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: "private-provider-detail" }));
    await expect(
      new OpenAiItineraryModel(config, transport).compose(
        fixtureBrief(),
        fixtureCandidates(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({ code: "ai_upstream_invalid_response" });
    expect(transport).toHaveBeenCalledOnce();
  });
  it("identifies unescaped content and keeps the provider envelope distinct without repair", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = Response.json({
      choices: [
        {
          finish_reason: "stop",
          message: { content: '{"title":"private\nmodel-text"}' },
        },
      ],
    });
    const transport = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () => new Response(await response.clone().text(), response),
      );
    await expect(
      new OpenAiItineraryModel(config, transport).compose(
        fixtureBrief(),
        fixtureCandidates(),
        new AbortController().signal,
      ),
    ).rejects.toMatchObject({
      code: "ai_invalid_json",
      message: expect.stringContaining("字符串转义错误"),
    });
    expect(String(warning.mock.calls[0]?.[0])).toContain(
      '"category":"control_character"',
    );
    expect(JSON.stringify(warning.mock.calls)).not.toContain("private");
    // 修补重试：转义错误会再请求一次（同一份坏响应），仍应失败且不泄露内容
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it("never includes engine snippets or unknown error strings in diagnostic metadata", () => {
    const summary = jsonFailureSummary(
      new SyntaxError("Unexpected token PRIVATE_SECRET at position 12"),
    );
    expect(summary).toEqual({ category: "syntax", offset: 12 });
    expect(JSON.stringify(summary)).not.toContain("PRIVATE_SECRET");
  });
});
