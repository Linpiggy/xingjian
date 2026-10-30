import { describe, expect, it } from "vitest";
import {
  parseItineraryOutput,
  itineraryCandidateKey,
} from "@/server/ai/itinerary-output";
import { uniqueItineraryVisits } from "@/domain/itinerary-selection";
import { fixtureCandidates, fixtureOutline } from "../fixtures/itinerary";

const candidates = fixtureCandidates();
function compact() {
  const outline = fixtureOutline();
  const choice = (item: (typeof outline.days)[number]["visits"][number]) => {
    const { placeId, ...rest } = item;
    return {
      ...rest,
      key: itineraryCandidateKey(
        candidates.findIndex((candidate) => candidate.place.id === placeId),
      ),
    };
  };
  return {
    title: outline.title,
    summary: outline.summary,
    days: outline.days.map((day) => ({
      theme: day.theme,
      visits: day.visits.map(choice),
      breakfast: choice(day.breakfast),
      lunch: choice(day.lunch),
      dinner: choice(day.dinner),
    })),
  };
}
describe("bounded compact model protocol", () => {
  it("resolves short keys back to only known candidate IDs and keeps meals and stay times", () => {
    const parsed = parseItineraryOutput(JSON.stringify(compact()), candidates);
    const original = fixtureOutline();
    expect(parsed.days).toEqual(original.days);
    expect(parsed.title).toBe(original.title);
  });
  it.each(["plain", "multiline", "inline", "bom"])(
    "accepts a complete %s JSON envelope without a repair call",
    (kind) => {
      const json = JSON.stringify(compact());
      const text =
        kind === "multiline"
          ? `\u0060\u0060\u0060json\n${json}\n\u0060\u0060\u0060`
          : kind === "inline"
            ? `\u0060\u0060\u0060json${json}\u0060\u0060\u0060`
            : kind === "bom"
              ? `\uFEFF${json}`
              : json;
      expect(parseItineraryOutput(text, candidates).days).toHaveLength(2);
    },
  );
  it("retains the validated legacy protocol", () => {
    expect(parseItineraryOutput(JSON.stringify(fixtureOutline()), candidates)).toEqual(
      fixtureOutline(),
    );
  });
  it("rejects unknown and wrong-kind keys rather than choosing a vaguely similar venue", () => {
    for (const key of ["P999", "P000", "P043", "P00001"]) {
      const wire = compact();
      wire.days[0].visits[0].key = key;
      expect(() => parseItineraryOutput(JSON.stringify(wire), candidates)).toThrow();
    }
  });
  it("cannot accept extra image fields, prose fragments, invalid commas or a truncated object", () => {
    const wire = compact();
    const text = JSON.stringify(wire);
    for (const value of [
      text.slice(0, -1),
      `${text.slice(0, -1)},}`,
      `解释：${text}`,
      JSON.stringify({ ...wire, photoUrl: "https://untrusted.invalid/image.jpg" }),
    ]) {
      expect(() => parseItineraryOutput(value, candidates)).toThrow();
    }
  });
  it("optional bad guides do not discard a valid compact core and cannot introduce URLs", () => {
    const wire = {
      ...compact(),
      guides: [{ key: "P001", experience: "https://untrusted.invalid/image.jpg" }],
    };
    const parsed = parseItineraryOutput(JSON.stringify(wire), candidates);
    expect(parsed.days).toHaveLength(2);
    expect(parsed.guides).toBeUndefined();
  });
});
describe("local reconciliation of valid duplicate visit choices", () => {
  it("removes a repeated visit without throwing away independent valid days or mutating the model outline", () => {
    const outline = fixtureOutline();
    outline.days[1].visits[0] = structuredClone(outline.days[0].visits[0]);
    const before = structuredClone(outline);
    const result = uniqueItineraryVisits(outline, candidates, new Set());
    const ids = result.outline.days.flatMap((day) =>
      day.visits.map((item) => item.placeId),
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect(result.outline.days[1].visits).toHaveLength(1);
    expect(result.notices.join()).toContain("去除 1 处重复景点");
    expect(outline).toEqual(before);
  });
  it("fills an emptied day from an unused public candidate, preferring an omitted required venue", () => {
    const outline = fixtureOutline();
    outline.days[1].visits = [structuredClone(outline.days[0].visits[0])];
    const required = candidates[8].place.id;
    const result = uniqueItineraryVisits(outline, candidates, new Set([required]));
    expect(result.outline.days[1].visits[0].placeId).toBe(required);
    expect(result.outline.days[1].visits[0].reason).toContain("公开候选补位");
    expect(result.notices[0]).toContain("未再次调用模型");
  });
  it("redistributes a surplus original selection when all public candidates were already used", () => {
    const outline = fixtureOutline();
    outline.days[1].visits = [structuredClone(outline.days[0].visits[0])];
    const result = uniqueItineraryVisits(outline, candidates.slice(0, 2), new Set());
    expect(result.outline.days.every((day) => day.visits.length === 1)).toBe(true);
    expect(
      new Set(
        result.outline.days.flatMap((day) => day.visits.map((choice) => choice.placeId)),
      ).size,
    ).toBe(2);
  });
  it("does not select a private map point to fill a duplicate day", () => {
    const outline = fixtureOutline();
    outline.days[1].visits = [structuredClone(outline.days[0].visits[0])];
    const privatePoint = structuredClone(candidates[7]);
    privatePoint.place.source = {
      kind: "user",
      provider: "user",
      coordinateSystem: "GCJ-02",
      queriedAt: "2026-10-29T00:00:00Z",
    };
    const result = uniqueItineraryVisits(
      outline,
      [...candidates.slice(0, 2), privatePoint],
      new Set([privatePoint.place.id]),
    );
    expect(
      result.outline.days
        .flatMap((day) => day.visits)
        .some((choice) => choice.placeId === privatePoint.place.id),
    ).toBe(false);
  });
});
