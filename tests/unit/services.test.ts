import { describe, expect, it, vi } from "vitest";
import { createDraft } from "@/server/services/create-draft";
import { ProviderError } from "@/server/providers/errors";
import { input, places, route } from "../fixtures/draft";

function fixtureProvider() {
  return {
    search: vi.fn(async (_city: string, keyword: string) =>
      places.filter((p) => p.name === keyword),
    ),
    route: vi.fn(async () => route),
  };
}
describe("draft service", () => {
  it("requests only adjacent same-day routes, not a full matrix", async () => {
    const provider = fixtureProvider();
    const draft = await createDraft(input, provider);
    expect(provider.search).toHaveBeenCalledTimes(4);
    expect(provider.route).toHaveBeenCalledTimes(2);
    expect(draft.status).toBe("unverified");
    expect(draft.days).toHaveLength(2);
  });
  it("honors the selected POI ID instead of the first search result", async () => {
    const provider = fixtureProvider();
    provider.search.mockResolvedValue([places[1], places[0]]);
    const draft = await createDraft(
      {
        ...input,
        keywords: [places[0].name, places[1].name],
        selections: [
          { kind: "amap", poiId: places[0].id, keyword: "query" },
          { kind: "amap", poiId: places[1].id, keyword: "query" },
        ],
      },
      provider,
    );
    expect(draft.days[0].items[0].place.id).toBe(places[0].id);
  });
  it("does not substitute another POI when the selected ID disappears", async () => {
    const provider = fixtureProvider();
    provider.search.mockResolvedValue([places[0]]);
    await expect(
      createDraft(
        {
          ...input,
          selections: input.keywords.map((keyword) => ({
            kind: "amap",
            poiId: "missing-id",
            keyword,
          })),
        },
        provider,
      ),
    ).rejects.toMatchObject({ code: "no_place" });
  });
  it("preserves user points without fabricating provider provenance", async () => {
    const provider = fixtureProvider();
    const draft = await createDraft(
      {
        ...input,
        keywords: ["自定义点一", "自定义点二"],
        selections: [
          { kind: "user", id: "user:one", name: "自定义点一", location: [120.1, 30.2] },
          { kind: "user", id: "user:two", name: "自定义点二", location: [120.2, 30.3] },
        ],
      },
      provider,
    );
    expect(provider.search).not.toHaveBeenCalled();
    expect(draft.days[0].items[0].place.source.kind).toBe("user");
    expect(draft.days[0].items[0].place.openingHours).toBeNull();
    expect(draft.notices.join()).toContain("用户地图选点");
  });
  it("keeps a draft with explicit route failure and unknown later timing", async () => {
    const provider = fixtureProvider();
    provider.route.mockRejectedValue(new ProviderError("unavailable", "测试路线失败"));
    const draft = await createDraft(input, provider);
    expect(draft.days[0].legs[0].route).toBeNull();
    expect(draft.days[0].items[1].startMinute).toBeNull();
    expect(draft.status).toBe("unverified");
  });
  it("does not fabricate places when search is empty", async () => {
    const provider = fixtureProvider();
    provider.search.mockResolvedValue([]);
    await expect(createDraft(input, provider)).rejects.toMatchObject({
      code: "no_place",
    });
  });
  it("rejects multiple keywords resolving to the same POI", async () => {
    const provider = fixtureProvider();
    provider.search.mockResolvedValue([places[0]]);
    await expect(createDraft(input, provider)).rejects.toMatchObject({
      code: "duplicate_place",
    });
  });
});
