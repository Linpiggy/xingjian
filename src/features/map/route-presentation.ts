import type { Day } from "@/domain/models";
import { stopIdentity } from "@/domain/meals";

export function routeMapPaths(day: Day) {
  return day.legs.flatMap((leg, index) => {
    const from = day.items[index];
    const to = day.items[index + 1];
    if (!from || !to) {
      return [];
    }
    return (leg.route?.segments ?? [])
      .filter((path) => path.length >= 2)
      .map((path) => ({ path, activityIds: [stopIdentity(from), stopIdentity(to)] }));
  });
}

export function routeLineStyle(state: "normal" | "selected" | "muted") {
  return {
    strokeColor: state === "selected" ? "#17563f" : "#33795f",
    strokeWeight: state === "selected" ? 8 : 7,
    strokeOpacity: state === "muted" ? 0.3 : 0.95,
    isOutline: true,
    borderWeight: 2,
    outlineColor: "#ffffff",
    lineJoin: "round" as const,
    lineCap: "round" as const,
    showDir: state !== "muted",
  };
}
