import { describe, expect, it } from "vitest";
import { routeLineStyle, routeMapPaths } from "@/features/map/route-presentation";
import { fixtureDraft } from "../fixtures/draft";

describe("route rendering instructions, no real SDK or provider calls", () => {
  it("preserves disconnected supplier paths and never draws a line between them", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.legs[0].route!.segments = [
      [
        [120.1, 30.2],
        [120.11, 30.2],
      ],
      [
        [120.3, 30.4],
        [120.31, 30.4],
      ],
      [[120.5, 30.6]],
    ];
    const paths = routeMapPaths(day);
    expect(paths).toHaveLength(2);
    expect(paths.map((segment) => segment.path)).toEqual(
      day.legs[0].route!.segments.slice(0, 2),
    );
    expect(paths.every((segment) => segment.path.length === 2)).toBe(true);
  });

  it("does not turn known endpoint coordinates into a fake route", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.legs[0].route = null;
    expect(routeMapPaths(day)).toEqual([]);
  });

  it("retains activity-instance selection even when two stops share a POI", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.items[0].activityId = "activity:breakfast";
    day.items[1].activityId = "activity:lunch";
    day.items[1].place = structuredClone(day.items[0].place);
    expect(routeMapPaths(day)[0].activityIds).toEqual([
      "activity:breakfast",
      "activity:lunch",
    ]);
  });

  it("uses casing and direction on supplied geometry, with a distinct selected and muted state", () => {
    const normal = routeLineStyle("normal");
    const selected = routeLineStyle("selected");
    const muted = routeLineStyle("muted");
    expect(normal.isOutline).toBe(true);
    expect(normal.outlineColor).toBe("#ffffff");
    expect(normal.showDir).toBe(true);
    expect(selected.strokeWeight).toBeGreaterThan(normal.strokeWeight);
    expect(muted.strokeOpacity).toBeLessThan(selected.strokeOpacity);
    expect(muted.showDir).toBe(false);
    expect(normal).not.toHaveProperty("path");
  });
});
