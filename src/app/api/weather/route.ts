import { weatherInputSchema, weatherReportSchema } from "@/lib/weather-contracts";
import { api, json, readBody, requireSameOrigin } from "@/server/http";
import { QWeatherProvider, weatherConfig } from "@/server/providers/qweather";
import { getWeather } from "@/server/services/get-weather";
import { todayInShanghai } from "@/server/today";

// Body parameters keep private point coordinates out of request URL logs.
export async function POST(request: Request): Promise<Response> {
  return api(async () => {
    requireSameOrigin(request);
    const input = weatherInputSchema.parse(await readBody(request));
    const report = await getWeather(
      input.date,
      input.location,
      todayInShanghai(),
      () => new QWeatherProvider(weatherConfig()),
      request.signal,
    );
    return json({ report: weatherReportSchema.parse(report) });
  });
}
