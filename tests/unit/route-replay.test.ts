import { describe, expect, it } from "vitest";
import { routeReplay, replayFrame, routeProjection } from "@/features/map/route-replay";
import { fixtureDraft } from "../fixtures/draft";

describe("route replay uses only supplied geometry, never a route estimate", () => {
  it("samples endpoints and the interior of the supplied segment", () => {
    const day = fixtureDraft().days[0];
    const track = routeReplay(day);
    expect(track.parts).toHaveLength(1);
    expect(replayFrame(track, 0).position).toEqual([120.1, 30.2]);
    expect(replayFrame(track, track.durationMs / 2).position![0]).toBeCloseTo(120.105);
    expect(replayFrame(track, track.durationMs).position).toEqual([120.11, 30.2]);
    expect(replayFrame(track, track.durationMs).finished).toBe(true);
  });
  it("does not mutate the itinerary or derive the presentation clock from travel time", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    const before = structuredClone(day);
    const track = routeReplay(day);
    expect(day).toEqual(before);
    day.legs[0].route!.seconds = 999_999;
    expect(routeReplay(day).durationMs).toBe(track.durationMs);
  });
  it("does not turn known endpoints and known seconds into a synthetic path", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.legs[0].route!.segments = [];
    expect(routeReplay(day)).toEqual({ parts: [], durationMs: 0, missingLegs: [0] });
    expect(replayFrame(routeReplay(day), 0).position).toBeNull();
  });
  it("preserves separate paths and hides the cursor while crossing a geometry gap", () => {
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
    ];
    const track = routeReplay(day);
    expect(track.parts.map((part) => part.path)).toEqual(day.legs[0].route!.segments);
    expect(track.parts[1].gapBefore).toBe(true);
    expect(replayFrame(track, track.parts[0].endMs + 350)).toMatchObject({
      gap: true,
      position: null,
    });
    expect(replayFrame(track, track.parts[1].startMs).position).toEqual([120.3, 30.4]);
  });
  it("does not bridge a missing leg even when the adjoining geometry has equal endpoints", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.items.push(structuredClone(day.items[0]), structuredClone(day.items[1]));
    day.legs.push(
      { ...structuredClone(day.legs[0]), route: null },
      structuredClone(day.legs[0]),
    );
    day.legs[2].route!.segments = [
      [
        [120.11, 30.2],
        [120.12, 30.2],
      ],
    ];
    const track = routeReplay(day);
    expect(track.missingLegs).toEqual([1]);
    expect(track.parts[1].legIndex).toBe(2);
    expect(track.parts[1].gapBefore).toBe(true);
  });
  it("does not insert a pause between exactly connected supplied segments", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.legs[0].route!.segments.push([
      [120.11, 30.2],
      [120.12, 30.2],
    ]);
    const track = routeReplay(day);
    expect(track.parts[1].startMs).toBe(track.parts[0].endMs);
    expect(track.parts[1].gapBefore).toBe(false);
  });
  it("rejects an entire invalid segment rather than connecting its valid prefix and suffix", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.legs[0].route!.segments = [
      [
        [120.1, 30.2],
        [NaN, 30.2],
        [120.11, 30.2],
      ],
      [
        [120.1, 91],
        [120.11, 30.2],
      ],
      [
        [181, 30.2],
        [120.11, 30.2],
      ],
      [[120.1, 30.2]],
      [
        [120.1, 30.2],
        [120.1, 30.2],
      ],
    ];
    expect(routeReplay(day).parts).toHaveLength(0);
  });
  it("handles repeated intermediate points without dividing by zero", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.legs[0].route!.segments[0].unshift([120.1, 30.2]);
    const track = routeReplay(day);
    expect(replayFrame(track, 0).position).toEqual([120.1, 30.2]);
    expect(
      replayFrame(track, track.durationMs / 2).position!.every(Number.isFinite),
    ).toBe(true);
  });
  it("clamps negative and oversized clocks and treats nonfinite input as the start", () => {
    const track = routeReplay(fixtureDraft().days[0]);
    expect(replayFrame(track, -100).position).toEqual(replayFrame(track, 0).position);
    expect(replayFrame(track, Number.NaN).position).toEqual(
      replayFrame(track, 0).position,
    );
    expect(replayFrame(track, track.durationMs + 100).finished).toBe(true);
  });
  it("does not associate orphan legs with nonexistent stops", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.items = [];
    expect(routeReplay(day).parts).toHaveLength(0);
  });
  it("projects known positions and geometry within a bounded frame without creating roads", () => {
    const day = fixtureDraft().days[0];
    const { project, paths } = routeProjection(day);
    expect(paths).toEqual(day.legs[0].route!.segments);
    for (const item of day.items) {
      const [x, y] = project(item.place.location);
      expect(x).toBeGreaterThanOrEqual(40);
      expect(x).toBeLessThanOrEqual(680);
      expect(y).toBeGreaterThanOrEqual(40);
      expect(y).toBeLessThanOrEqual(400);
    }
  });
  it("preserves geometric aspect across a wide modal and a narrow map preview", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.legs[0].route!.segments[0].push([120.11, 30.21]);
    for (const size of [
      { width: 1400, height: 500 },
      { width: 300, height: 400 },
    ]) {
      const { project } = routeProjection(day, size);
      const [left, bottom] = project([120.1, 30.2]);
      const [right] = project([120.11, 30.2]);
      const [, top] = project([120.11, 30.21]);
      expect((right - left) / (bottom - top)).toBeCloseTo(
        Math.cos((30.205 * Math.PI) / 180),
        4,
      );
      expect(left).toBeGreaterThanOrEqual(40);
      expect(right).toBeLessThanOrEqual(size.width - 40);
      expect(top).toBeGreaterThanOrEqual(40);
      expect(bottom).toBeLessThanOrEqual(size.height - 40);
    }
  });
  it("handles empty and coincident positions without invalid SVG coordinates", () => {
    const day = structuredClone(fixtureDraft().days[0]);
    day.legs = [];
    day.items[1].place.location = [...day.items[0].place.location];
    expect(routeProjection(day).project(day.items[0].place.location)).toEqual([360, 220]);
    day.items = [];
    expect(routeProjection(day).project([120, 30])).toEqual([360, 220]);
  });
});
