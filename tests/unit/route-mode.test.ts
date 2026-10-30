import { describe, expect, it } from "vitest";
import {
  suggestedRouteMode,
  straightLineMeters,
  WALK_LIMIT_METERS,
} from "@/server/services/create-itinerary";

describe("transport mode selection", () => {
  it("keeps short hops on foot and sends long hops to a driving query", () => {
    const near = suggestedRouteMode([120.1, 30.2], [120.105, 30.2]);
    const mid = suggestedRouteMode([120.1, 30.2], [120.13, 30.2]);
    const far = suggestedRouteMode([120.1, 30.2], [120.2, 30.3]);
    expect(near).toBe("walking");
    expect(mid).toBe("driving");
    expect(far).toBe("driving");
  });

  it("measures straight-line distance only for coarse screening", () => {
    const meters = straightLineMeters([120.1, 30.2], [120.11, 30.2]);
    expect(meters).toBeGreaterThan(900);
    expect(meters).toBeLessThan(1_100);
    expect(WALK_LIMIT_METERS).toBe(1_500);
  });
});
