import type { PlaceCandidate, PlaceProvider } from "@/domain/models";
import type {
  RecommendationInput,
  RecommendationModel,
} from "@/server/ai/openai-compatible";
import { ProviderError } from "@/server/providers/errors";

const searchTerms = {
  自然风光: "公园",
  博物馆: "博物馆",
  城市漫步: "历史街区",
  当地美食: "特色餐厅",
};
let active = false;
let started: number[] = [];

export async function recommendPlaces(
  input: RecommendationInput,
  places: PlaceProvider,
  ai: RecommendationModel,
) {
  const now = Date.now();
  started = started.filter((time) => now - time < 60_000);
  if (active || started.length >= 3) {
    throw new ProviderError(
      "unavailable",
      "AI 推荐请求过于频繁，请稍后重试。",
      "rate_limited",
    );
  }
  active = true;
  started.push(now);
  try {
    const candidates: PlaceCandidate[] = [];
    for (const interest of new Set(input.interests)) {
      const keyword = searchTerms[interest];
      for (const place of await places.search(input.city, keyword)) {
        if (!candidates.some((candidate) => candidate.place.id === place.id)) {
          candidates.push({
            place,
            selection: { kind: "amap", poiId: place.id, keyword },
          });
        }
      }
    }
    if (candidates.length < input.dayCount) {
      throw new ProviderError(
        "unavailable",
        "真实地点候选不足，请调整兴趣或使用自定义搜索。",
        "no_place",
      );
    }
    const choices = await ai.select(input, candidates);
    const ids = new Set(choices.map((choice) => choice.placeId));
    if (
      ids.size !== choices.length ||
      choices.length < input.dayCount ||
      choices.length > 6 ||
      choices.some(
        (choice) =>
          !candidates.some((candidate) => candidate.place.id === choice.placeId),
      )
    ) {
      throw new ProviderError(
        "unavailable",
        "AI 返回了不在候选中的地点或重复地点，推荐未生效。",
        "ai_invalid_response",
      );
    }
    return {
      recommendations: choices.map((choice) => ({
        ...candidates.find((candidate) => candidate.place.id === choice.placeId)!,
        reason: choice.reason,
      })),
      model: ai.model,
      queriedAt: new Date().toISOString(),
    };
  } finally {
    active = false;
  }
}
