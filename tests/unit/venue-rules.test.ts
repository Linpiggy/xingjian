import { describe, expect, it } from "vitest";
import { buildVenueRules, initialVenueFields } from "@/features/itinerary/venue-form";
import { places } from "../fixtures/draft";

const place = places[0]!;
const recordedAt = "2026-10-30T02:00:00Z";

describe("venue rules form", () => {
  it("keeps a missing record as unknown instead of open or closed", () => {
    const fields = initialVenueFields(null, "2026-11-06", place);
    expect(fields.enabled).toBe(false);
    expect(buildVenueRules(fields, place, null, recordedAt)).toBeNull();
  });

  it("keeps an explicit closed day distinct from no record", () => {
    const fields = {
      ...initialVenueFields(null, "2026-11-06", place),
      enabled: true,
      opening: "closed" as const,
    };
    const rules = buildVenueRules(fields, place, null, recordedAt);
    expect(rules?.openingWindows).toEqual([]);
  });

  it("refuses an empty window list when opening hours are declared known", () => {
    const fields = {
      ...initialVenueFields(null, "2026-11-06", place),
      enabled: true,
      opening: "windows" as const,
      windows: [],
    };
    expect(() => buildVenueRules(fields, place, null, recordedAt)).toThrow(
      /至少填写一段/,
    );
  });
});
