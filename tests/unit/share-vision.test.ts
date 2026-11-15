import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { simplifyPath } from "@/lib/geo";
import { tripRequestSchema, tripSchema } from "@/lib/schema";
import { decodeShare, encodeShare } from "@/lib/share";
import { extractJson, normalizeInsight } from "@/server/llm/vision";

const sample = JSON.parse(readFileSync("src/data/samples/hangzhou.json", "utf8"));
const request = tripRequestSchema.parse(sample.request);
const trip = tripSchema.parse(sample.trip);

describe("share link", () => {
  it("round-trips a trip through the compressed link", async () => {
    const code = await encodeShare(request, trip);
    expect(code.startsWith("1.")).toBe(true);
    expect(code.length).toBeLessThan(15_000);
    const decoded = await decodeShare(code);
    expect(decoded.trip.title).toBe(trip.title);
    expect(decoded.trip.days.flatMap((day) => day.stops).length).toBe(
      trip.days.flatMap((day) => day.stops).length,
    );
    expect(decoded.trip.candidates).toEqual([]);
  });

  it("rejects tampered links and drops untrusted image hosts", async () => {
    await expect(decodeShare("1.not-valid")).rejects.toThrow();
    const tampered = {
      ...trip,
      days: trip.days.map((day) => ({
        ...day,
        stops: day.stops.map((stop) => ({
          ...stop,
          place: { ...stop.place, photos: ["https://evil.example/track.png"] },
        })),
      })),
    };
    const decoded = await decodeShare(await encodeShare(request, tampered));
    expect(decoded.trip.days[0].stops[0].place.photos).toEqual([]);
  });

  it("simplifies dense polylines but keeps endpoints", () => {
    const line = Array.from(
      { length: 50 },
      (_, i) => [120 + i * 0.0001, 30] as [number, number],
    );
    const simplified = simplifyPath(line);
    expect(simplified).toEqual([line[0], line[49]]);
    const corner: [number, number][] = [
      [120, 30],
      [120.01, 30],
      [120.01, 30.01],
    ];
    expect(simplifyPath(corner)).toHaveLength(3);
  });
});

describe("vision output parsing", () => {
  it("extracts JSON wrapped in prose or code fences", () => {
    expect(extractJson('好的：\n```json\n{"scene":"湖"}\n```')).toEqual({ scene: "湖" });
    expect(extractJson('结果 {"city":"杭州"} 以上')).toEqual({ city: "杭州" });
    expect(() => extractJson("看不出来")).toThrow();
  });

  it("keeps only allowed interests and strips links", () => {
    const insight = normalizeInsight({
      scene: "西湖断桥 https://x.example",
      place: "断桥残雪",
      city: "杭州市",
      confidence: "high",
      styles: ["山水"],
      interests: ["自然风光", "黑客技术"],
      suggestions: [{ city: "杭州", reason: "湖光山色" }],
      note: "想看日落",
    });
    expect(insight.city).toBe("杭州");
    expect(insight.interests).toEqual(["自然风光"]);
    expect(insight.scene).not.toContain("http");
  });

  it("falls back safely on malformed fields", () => {
    const insight = normalizeInsight({ confidence: "very", suggestions: "x" });
    expect(insight.confidence).toBe("low");
    expect(insight.suggestions).toEqual([]);
  });
});

describe("photo proxy allowlist", () => {
  it("only accepts https images on Amap domains", async () => {
    const { isAllowedPhoto } = await import("@/lib/photo");
    expect(isAllowedPhoto("https://store.is.autonavi.com/showpic/abc")).not.toBeNull();
    expect(isAllowedPhoto("https://aos-comment.amap.com/x.jpg")).not.toBeNull();
    expect(isAllowedPhoto("http://store.is.autonavi.com/showpic/abc")).toBeNull();
    expect(isAllowedPhoto("https://evil.example/autonavi.com.jpg")).toBeNull();
    expect(isAllowedPhoto("https://user:pw@store.is.autonavi.com/x")).toBeNull();
    expect(isAllowedPhoto("not a url")).toBeNull();
  });
});

describe("vision model configuration", () => {
  it("reuses the main DeepSeek key and model when no separate vision key is set", async () => {
    const { vi } = await import("vitest");
    const { analyzePhoto } = await import("@/server/llm/vision");
    vi.stubEnv("VISION_API_KEY", "");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("DEEPSEEK_API_KEY", "ds-test");
    const fetchMock = vi.fn(async () =>
      Response.json({
        choices: [
          { message: { content: '{"scene":"湖","city":"杭州","confidence":"high"}' } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const insight = await analyzePhoto(
      "data:image/jpeg;base64,AAAA",
      new AbortController().signal,
    );
    expect(insight.city).toBe("杭州");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [URL, RequestInit];
    expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("deepseek-flash");
    expect(body.thinking).toEqual({ type: "disabled" });
    expect(body.messages[0].content[0].image_url.url).toBe("data:image/jpeg;base64,AAAA");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer ds-test");
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });
});
