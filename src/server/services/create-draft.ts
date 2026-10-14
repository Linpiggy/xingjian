import { groupPlaces, makeDay, makeDraft } from "@/domain/draft";
import type {
  Draft,
  Leg,
  Place,
  PlaceProvider,
  RouteProvider,
  TripInput,
} from "@/domain/models";
import { addDays } from "@/domain/draft";
import { ProviderError } from "@/server/providers/errors";

export async function createDraft(
  input: TripInput,
  provider: PlaceProvider & RouteProvider,
): Promise<Draft> {
  const places: Place[] = [];
  const notices = [
    "行程时间为估算。出行前请确认开放、预约、用餐、返程与费用。",
    "地点按添加顺序分天；停留与缓冲时间采用你的设置。",
  ];
  for (const [index, keyword] of input.keywords.entries()) {
    const selection = input.selections?.[index];
    const candidates =
      selection?.kind === "user"
        ? []
        : await provider.search(input.city, selection?.keyword ?? keyword);
    const place: Place | undefined =
      selection?.kind === "user"
        ? {
            id: selection.id,
            name: selection.name,
            location: selection.location,
            address: null,
            citycode: null,
            openingHours: null,
            source: {
              kind: "user",
              provider: "user",
              coordinateSystem: "GCJ-02",
              queriedAt: new Date().toISOString(),
            },
          }
        : selection?.kind === "amap"
          ? candidates.find((candidate) => candidate.id === selection.poiId)
          : (candidates.find((candidate) => candidate.name === keyword) ?? candidates[0]);
    if (!place) {
      throw new ProviderError(
        "unavailable",
        `未找到“${keyword}”的有效地点，请填写更具体的名称。`,
        "no_place",
      );
    }
    if (places.some((p) => p.id === place.id)) {
      throw new ProviderError(
        "unavailable",
        "多个名称匹配到同一地点，请改用不同地点。",
        "duplicate_place",
      );
    }
    if (place.source.kind === "user") {
      notices.push(
        `“${place.name}”来自用户地图选点，名称、入口与城市范围未由供应商核实。`,
      );
    }
    if (place.name !== keyword) {
      notices.push(`“${keyword}”采用搜索匹配“${place.name}”，请核实是否符合你的意图。`);
    }
    places.push(place);
  }
  const days = [];
  for (const [index, group] of groupPlaces(places, input.dayCount).entries()) {
    const legs: Leg[] = [];
    for (let i = 1; i < group.length; i++) {
      const from = group[i - 1],
        to = group[i];
      try {
        legs.push({
          fromId: from.id,
          toId: to.id,
          route: await provider.walking(from.location, to.location),
          error: null,
        });
      } catch (error) {
        if (!(error instanceof ProviderError)) {
          throw error;
        }
        legs.push({ fromId: from.id, toId: to.id, route: null, error: error.message });
      }
    }
    days.push(
      makeDay(
        addDays(input.startDate, index),
        group,
        legs,
        input.stayMinutes,
        input.bufferMinutes,
      ),
    );
  }
  return makeDraft(
    { ...input, keywords: places.map((place) => place.name) },
    days,
    notices,
  );
}
