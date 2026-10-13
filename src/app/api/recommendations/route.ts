import {
  recommendationInputSchema,
  recommendationsResponseSchema,
} from "@/lib/contracts";
import { api, json, readBody, requireSameOrigin } from "@/server/http";
import { configuredAmap } from "@/server/providers/configured-amap";
import { modelConfig } from "@/server/ai/config";
import { OpenAiCompatibleModel } from "@/server/ai/openai-compatible";
import { recommendPlaces } from "@/server/services/recommend-places";

export async function POST(request: Request): Promise<Response> {
  return api(async () => {
    requireSameOrigin(request);
    const input = recommendationInputSchema.parse(await readBody(request));
    const model = new OpenAiCompatibleModel(modelConfig());
    const result = await recommendPlaces(input, configuredAmap(), model);
    return json(recommendationsResponseSchema.parse(result));
  });
}
