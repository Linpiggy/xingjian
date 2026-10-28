import { describe, expect, it, vi } from "vitest";
import {
  itineraryGuideSchema,
  itineraryOutlineSchema,
  itinerarySchema,
} from "@/lib/itinerary-contracts";
import { OpenAiItineraryModel } from "@/server/ai/itinerary-model";
import { prepareItineraryMove } from "@/domain/itinerary-moves";
import { changeItinerary } from "@/domain/itinerary-editing";
import {
  fixtureBrief,
  fixtureCandidates,
  fixtureItinerary,
  fixtureOutline,
} from "../fixtures/itinerary";

describe("bounded place guidance, not verified venue facts", () => {
  it.each([1, 14])(
    "deduplicates guides by POI for %i days and attaches them to activity instances",
    (dayCount) => {
      const brief = fixtureBrief();
      brief.dayCount = dayCount;
      const outline = fixtureOutline(brief);
      expect(outline.guides).toHaveLength(dayCount * 2 + 3);
      expect(itineraryOutlineSchema.safeParse(outline).success).toBe(true);
      const plan = fixtureItinerary(brief);
      expect(itinerarySchema.safeParse(plan).success).toBe(true);
      expect(
        plan.days.flatMap((day) => day.recommendations).every((item) => item.guide),
      ).toBe(true);
      expect(plan.days[0].recommendations[0].guide).toEqual(
        plan.days.at(-1)!.recommendations[0].guide,
      );
    },
  );

  it("rejects URLs, arbitrary images, empty sections and oversized text without making facts", () => {
    const guide = fixtureItinerary().days[0].recommendations[1].guide!;
    expect(itineraryGuideSchema.safeParse(guide).success).toBe(true);
    for (const invalid of [
      { ...guide, experience: "x".repeat(241) },
      { ...guide, highlights: [] },
      { ...guide, tips: ["https://example.invalid/venue"] },
      { ...guide, checkBeforeGo: ["javascript:alert(1)"] },
      { ...guide, photoUrl: "https://example.invalid/photo.jpg" },
      { ...guide, source: "verified" },
    ]) {
      expect(itineraryGuideSchema.safeParse(invalid).success).toBe(false);
    }
  });

  it("rejects duplicate and unselected guide identities", () => {
    for (const variant of ["duplicate", "unselected"]) {
      const outline = fixtureOutline();
      if (variant === "duplicate") {
        outline.guides!.push(structuredClone(outline.guides![0]));
      } else {
        outline.guides![0].placeId = "invented-place";
      }
      expect(itineraryOutlineSchema.safeParse(outline).success).toBe(false);
    }
  });

  it("keeps legacy snapshots without guides valid, but refuses repeated activity explanations", () => {
    const plan = fixtureItinerary();
    for (const day of plan.days) {
      for (const recommendation of day.recommendations) {
        delete recommendation.guide;
      }
    }
    expect(itinerarySchema.safeParse(plan).success).toBe(true);
    plan.days[0].recommendations.push(structuredClone(plan.days[0].recommendations[0]));
    expect(itinerarySchema.safeParse(plan).success).toBe(false);
  });

  it.each(["missing", "partial"])(
    "accepts %s optional guidance without another charged request",
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
      const model = new OpenAiItineraryModel(
        {
          key: "fixture-model-secret",
          endpoint: new URL("https://api.deepseek.com/chat/completions"),
          model: "fixture-model",
        },
        transport,
      );
      await expect(
        model.compose(fixtureBrief(), fixtureCandidates(), new AbortController().signal),
      ).resolves.toEqual(outline);
      expect(transport).toHaveBeenCalledOnce();
    },
  );

  it("preserves guidance during duration changes and transfers the same instance explanation across days", () => {
    const plan = fixtureItinerary();
    const activityId = plan.days[0].schedule!.items[1].activity.id;
    const original = structuredClone(plan);
    const changed = changeItinerary(plan, {
      kind: "duration",
      activityId,
      stayMinutes: 45,
    });
    expect(changed.days[0].recommendations).toEqual(plan.days[0].recommendations);
    const moved = prepareItineraryMove(plan, {
      kind: "move",
      activityId,
      toDay: 1,
      toIndex: 1,
    });
    expect(
      moved.days[0].recommendations.some((item) => item.activityId === activityId),
    ).toBe(false);
    expect(
      moved.days[1].recommendations.find((item) => item.activityId === activityId),
    ).toEqual(plan.days[0].recommendations[1]);
    expect(plan).toEqual(original);
  });
});
