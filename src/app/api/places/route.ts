import { searchInputSchema } from "@/lib/contracts";
import { api, json } from "@/server/http";
import { configuredAmap } from "@/server/providers/configured-amap";

export async function GET(request: Request): Promise<Response> {
  return api(async () => {
    const query = searchInputSchema.parse(
      Object.fromEntries(new URL(request.url).searchParams),
    );
    const places = await configuredAmap().search(query.city, query.keyword);
    return json({ places });
  });
}
