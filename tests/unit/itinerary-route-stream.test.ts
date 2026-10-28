import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fixtureBrief } from "../fixtures/itinerary";

const compose = vi.hoisted(() => vi.fn());
vi.mock("@/server/services/create-itinerary", () => ({ createItinerary: compose }));
import { POST } from "@/app/api/itineraries/route";

beforeEach(() => {
  compose.mockReset();
  vi.stubEnv("AMAP_WEB_SERVICE_KEY", "fixture-web-key");
  vi.stubEnv("OPENAI_API_KEY", "fixture-model-secret");
  vi.stubEnv("OPENAI_BASE_URL", "https://example.invalid/v1");
  compose.mockImplementation(
    (
      _brief,
      _provider,
      _model,
      signal: AbortSignal,
      progress: (message: string, stage: string) => void,
    ) => {
      progress("fixture model progress", "model");
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    },
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
function request(signal: AbortSignal) {
  return new Request("http://127.0.0.1:3100/api/itineraries", {
    method: "POST",
    signal,
    headers: { Origin: "http://127.0.0.1:3100", "Content-Type": "application/json" },
    body: JSON.stringify(fixtureBrief()),
  });
}

describe("real route stream lifecycle with mocked application service", () => {
  it("emits a terminal typed deadline error rather than silently ending progress", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const response = await POST(request(new AbortController().signal));
    const text = response.text();
    deadline.abort(new DOMException("fixture", "TimeoutError"));
    const events = (await text)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.at(-1)).toMatchObject({
      type: "error",
      stage: "model",
      code: "generation_timeout",
    });
    expect(events.some((event) => event.type === "result")).toBe(false);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(compose).toHaveBeenCalledOnce();
  });

  it("does not send a misleading timeout or result after the traveler cancels", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const client = new AbortController();
    const response = await POST(request(client.signal));
    const text = response.text();
    client.abort();
    const events = (await text)
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(events.every((event) => event.type === "progress")).toBe(true);
    expect(compose).toHaveBeenCalledOnce();
  });
});
