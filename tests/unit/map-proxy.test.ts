import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/%5FAMapService/[...path]/route";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});
function configured() {
  vi.stubEnv("NEXT_PUBLIC_AMAP_JS_KEY", "fixture-public-js-key");
  vi.stubEnv("AMAP_JS_SECURITY_CODE", "fixture-private-jscode");
}
function invoke(path: string[], query = "") {
  return GET(new Request(`http://localhost/_AMapService/${path.join("/")}${query}`), {
    params: Promise.resolve({ path }),
  });
}

describe("same-origin map proxy (mock upstream)", () => {
  it("returns not configured without invoking an upstream", async () => {
    vi.stubEnv("AMAP_JS_SECURITY_CODE", "");
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const result = await invoke(["v3", "place", "text"]);
    expect(result.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("injects server security only into the fixed upstream request", async () => {
    configured();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ fixture: true }));
    vi.stubGlobal("fetch", fetcher);
    const response = await invoke(
      ["v3", "place", "text"],
      "?key=ignored&jscode=ignored&keywords=test",
    );
    const url = new URL(String(fetcher.mock.calls[0][0]));
    expect(url.hostname).toBe("restapi.amap.com");
    expect(url.searchParams.get("key")).toBe("fixture-public-js-key");
    expect(url.searchParams.get("jscode")).toBe("fixture-private-jscode");
    expect(await response.text()).not.toContain("fixture-private-jscode");
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("routes map styles to the official style host", async () => {
    configured();
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ fixture: true }));
    vi.stubGlobal("fetch", fetcher);
    await invoke(["v4", "map", "styles"]);
    expect(new URL(String(fetcher.mock.calls[0][0])).hostname).toBe("webapi.amap.com");
  });
  it("rejects traversal and external URL paths", async () => {
    configured();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    for (const path of [
      ["v3", "..", "place"],
      ["https:", "evil.invalid"],
    ]) {
      expect((await invoke(path)).status).toBe(400);
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("rejects cross-site calls", async () => {
    configured();
    const fetcher = vi.fn<typeof fetch>();
    vi.stubGlobal("fetch", fetcher);
    const response = await GET(
      new Request("http://localhost/_AMapService/v3/place/text", {
        headers: { origin: "https://evil.invalid" },
      }),
      { params: Promise.resolve({ path: ["v3", "place", "text"] }) },
    );
    expect(response.status).toBe(403);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
