import { planResponseSchema, tripInputSchema } from "@/lib/contracts";
import { api, json, readBody, requireSameOrigin } from "@/server/http";
import { configuredAmap } from "@/server/providers/configured-amap";
import { createDraft } from "@/server/services/create-draft";

export async function POST(request: Request): Promise<Response> {
  return api(async () => {
    requireSameOrigin(request);
    const input = tripInputSchema.parse(await readBody(request));
    const draft = await createDraft(input, configuredAmap());
    // No database or persistent plan is created in this first iteration.
    return json(planResponseSchema.parse({ draft }));
  });
}
