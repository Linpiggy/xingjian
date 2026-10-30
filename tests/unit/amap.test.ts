import { describe, expect, it, vi } from "vitest";
import { AmapProvider, parseCoordinate } from "@/server/providers/amap";

function provider(raw: unknown, status = 200) {
  const transport = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json(raw, { status }));
  return { api: new AmapProvider("fixture-server-key", transport), transport };
}
describe("Amap adapter (mock transport, no paid calls)", () => {
  it("validates coordinates", () => {
    expect(parseCoordinate("120.1,30.2")).toEqual([120.1, 30.2]);
    for (const s of ["", "1,2,3", "200,30", "120x,30", "NaN,30"]) {
      expect(parseCoordinate(s)).toBeNull();
    }
  });
  it("preserves missing fields as null", async () => {
    const { api, transport } = provider({
      status: "1",
      infocode: "10000",
      pois: [
        {
          id: "fixture-a",
          name: "测试地点",
          location: "120.1,30.2",
          business: [],
          address: [],
        },
      ],
    });
    const [p] = await api.search("测试城市", "测试地点");
    expect(p.address).toBeNull();
    expect(p.openingHours).toBeNull();
    expect(p.source.coordinateSystem).toBe("GCJ-02");
    const url = new URL(String(transport.mock.calls[0][0]));
    expect(url.hostname).toBe("restapi.amap.com");
    expect(url.searchParams.get("city_limit")).toBe("true");
  });
  it("empty results are distinct from failure", async () => {
    expect(await provider({ status: "1", pois: [] }).api.search("城", "名")).toEqual([]);
  });
  it("unconfigured key performs no request", async () => {
    const transport = vi.fn<typeof fetch>();
    await expect(
      new AmapProvider("", transport).search("城", "名"),
    ).rejects.toMatchObject({ status: "not_configured" });
    expect(transport).not.toHaveBeenCalled();
  });
  it("HTTP 200 is not business success", async () => {
    await expect(
      provider({ status: "0", infocode: "10001" }).api.search("城", "名"),
    ).rejects.toMatchObject({ status: "permission_denied" });
  });
  it("handles rate limiting", async () => {
    await expect(provider({}, 429).api.search("城", "名")).rejects.toMatchObject({
      code: "rate_limited",
    });
  });
  it("rejects invalid external shapes", async () => {
    await expect(
      provider({ status: "1", pois: "invalid" }).api.search("城", "名"),
    ).rejects.toMatchObject({ status: "unavailable" });
  });
  it("does not leak secrets from network exceptions", async () => {
    const transport = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("https://restapi.amap.com?key=fixture-server-key"));
    await expect(
      new AmapProvider("fixture-server-key", transport).search("城", "名"),
    ).rejects.toThrow("高德请求超时、网络异常或返回格式错误。");
  });
  it("extracts true seconds and each polyline separately", async () => {
    const { api } = provider({
      status: "1",
      route: {
        paths: [
          {
            distance: "1200",
            cost: { duration: "1200" },
            steps: [
              { polyline: "120.1,30.2;120.2,30.3" },
              { polyline: "invalid;120.2,30.3" },
              { polyline: "120.3,30.4;120.4,30.5" },
            ],
          },
        ],
      },
    });
    const r = await api.route([120.1, 30.2], [120.4, 30.5], "walking");
    expect(r.seconds).toBe(1200);
    expect(r.segments).toHaveLength(2);
  });
  it("missing duration and geometry remain unknown", async () => {
    const r = await provider({ status: "1", route: { paths: [{}] } }).api.route(
      [120, 30],
      [120.1, 30.1],
      "walking",
    );
    expect(r.seconds).toBeNull();
    expect(r.meters).toBeNull();
    expect(r.segments).toEqual([]);
  });
  it("empty routes return a no-route error", async () => {
    await expect(
      provider({ status: "1", route: { paths: [] } }).api.route(
        [120, 30],
        [120.1, 30.1],
        "walking",
      ),
    ).rejects.toMatchObject({ code: "no_route" });
  });
});

describe("driving route queries", () => {
  it("marks driving results and states the reference caveat", async () => {
    const r = await provider({
      status: "1",
      route: {
        paths: [
          {
            distance: "5200",
            cost: { duration: "780" },
            steps: [{ polyline: "120.1,30.2;120.2,30.3" }],
          },
        ],
      },
    }).api.route([120.1, 30.2], [120.2, 30.3], "driving");
    expect(r.mode).toBe("driving");
    expect(r.detail).toContain("未含实时路况");
    expect(r.meters).toBe(5200);
  });
});
