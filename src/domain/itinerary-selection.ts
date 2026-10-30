import type { ItineraryCandidate, ItineraryOutline } from "./itinerary";

// Only removes repeated, already validated visit IDs. It cannot invent a place,
// correct an unknown ID, substitute a restaurant or call a model/provider.
export function uniqueItineraryVisits(
  source: ItineraryOutline,
  candidates: ItineraryCandidate[],
  requiredIds: ReadonlySet<string>,
) {
  const outline = structuredClone(source);
  const used = new Set<string>();
  let removed = 0;
  let filled = 0;
  for (const day of outline.days) {
    day.visits = day.visits.filter((choice) => {
      if (used.has(choice.placeId)) {
        removed += 1;
        return false;
      }
      used.add(choice.placeId);
      return true;
    });
  }
  for (const day of outline.days) {
    if (day.visits.length) {
      continue;
    }
    const anchor = candidates.find(
      (candidate) => candidate.place.id === day.breakfast.placeId,
    )?.place.location;
    const distance = (candidate: ItineraryCandidate) =>
      anchor
        ? (candidate.place.location[0] - anchor[0]) ** 2 +
          (candidate.place.location[1] - anchor[1]) ** 2
        : 0;
    const spare = candidates
      .filter(
        (candidate) =>
          candidate.kind === "visit" &&
          candidate.place.source.kind !== "user" &&
          !used.has(candidate.place.id),
      )
      .sort(
        (a, b) =>
          Number(requiredIds.has(b.place.id)) - Number(requiredIds.has(a.place.id)) ||
          distance(a) - distance(b) ||
          a.place.id.localeCompare(b.place.id),
      );
    if (spare[0]) {
      const placeId = spare[0].place.id;
      day.visits.push({
        placeId,
        stayMinutes: 60,
        reason: "重复景点已去除；此处为公开候选补位，体验与开放情况待核实。",
      });
      used.add(placeId);
    } else {
      const donor = outline.days.find((value) => value.visits.length > 1);
      if (!donor) {
        throw new Error("Insufficient unique visits");
      }
      day.visits.push(donor.visits.pop()!);
    }
    filled += 1;
  }
  return {
    outline,
    notices: removed
      ? [
          `已去除 ${removed} 处重复景点${filled ? `，为 ${filled} 天补入或重新分配公开候选` : ""}；未再次调用模型，补位安排请复核。`,
        ]
      : [],
  };
}
