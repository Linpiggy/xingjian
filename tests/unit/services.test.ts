import { describe, expect, it, vi } from "vitest";
import { createDraft } from "@/server/services/create-draft";
import { ProviderError } from "@/server/providers/errors";
import { input, places, route } from "../fixtures/draft";

function fixtureProvider() {
  return {
    search: vi.fn(async (_city: string, keyword: string) =>
      places.filter((p) => p.name === keyword),
    ),
    walking: vi.fn(async () => route),
  };
}
describe("draft service", () => {
  it("requests only adjacent same-day routes, not a full matrix", async () => {
    const provider = fixtureProvider();
    const draft = await createDraft(input, provider);
    expect(provider.search).toHaveBeenCalledTimes(4);
    expect(provider.walking).toHaveBeenCalledTimes(2);
    expect(draft.status).toBe("unverified");
    expect(draft.days).toHaveLength(2);
  });
  it("keeps a draft with explicit route failure and unknown later timing", async () => {
    const provider = fixtureProvider();
    provider.walking.mockRejectedValue(new ProviderError("unavailable", "测试路线失败"));
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
