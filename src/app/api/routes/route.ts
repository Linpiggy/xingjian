import { routeInputSchema } from "@/lib/contracts";
import { api, json, readBody, requireSameOrigin } from "@/server/http";
import { configuredAmap } from "@/server/providers/configured-amap";

export async function POST(request: Request): Promise<Response> {
  return api(async () => {
    requireSameOrigin(request);
    const input = routeInputSchema.parse(await readBody(request));
    return json({
      route: await configuredAmap().walking(input.origin, input.destination),
    });
  });
}
