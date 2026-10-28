// Explicit, single-attempt model contract check. Not part of check/E2E.
// Run with: node --import tsx scripts/smoke-itinerary-model.ts --live
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { z } from "zod";
import { AmapProvider } from "../src/server/providers/amap";
import { ProviderError } from "../src/server/providers/errors";
import { modelConfig } from "../src/server/ai/config";
import { OpenAiItineraryModel } from "../src/server/ai/itinerary-model";
import { withAiBudget } from "../src/server/ai/budget";
import { itineraryOutlineSchema } from "../src/lib/itinerary-contracts";
import { tripBriefSchema } from "../src/lib/trip-brief-contracts";
import { todayInShanghai } from "../src/server/today";
import type { ItineraryCandidate } from "../src/domain/itinerary";

const maximumCalls = { placeSearch: 2, model: 1, walking: 0, weather: 0, database: 0 };
async function main() {
  if (!process.argv.includes("--live")) {
    console.log(JSON.stringify({ status: "dry_run", maximumCalls, automaticRetries: 0 }));
    return;
  }
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const file = `docs/evidence/itinerary-model-smoke-${new Date().toISOString().slice(0, 10)}.json`;
  if (existsSync(file)) {
    throw new Error("Attempt already exists; no further requests permitted.");
  }
  const privateValues = [
    process.env.OPENAI_API_KEY,
    process.env.DEEPSEEK_API_KEY,
    process.env.AMAP_WEB_SERVICE_KEY,
    process.env.AMAP_JS_SECURITY_CODE,
  ].filter((value): value is string => Boolean(value));
  const report = {
    kind: "real_itinerary_model_contract_only",
    checkedAt: new Date().toISOString(),
    status: "started",
    inputSummary: { city: "杭州", dayCount: 1, travelers: 1 },
    maximumCalls,
    attempts: { placeSearch: 0, model: 0 },
    automaticRetries: 0,
    elapsedMs: 0,
    model: {} as Record<string, unknown>,
    publicErrorCode: null as string | null,
    limitations: [
      "Test city only, not the product destination",
      "No route, schedule feasibility, UI, weather, persistence or production rights verification",
      "No raw POI/model content or credentials retained",
    ],
  };
  function save() {
    const text = JSON.stringify(report, null, 2) + "\n";
    if (privateValues.some((value) => text.includes(value))) {
      throw new Error("Private value detected; evidence not written.");
    }
    writeFileSync(file, text, "utf8");
    if (readFileSync(file, "utf8") !== text) {
      throw new Error("Evidence write verification failed.");
    }
  }
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n", {
    encoding: "utf8",
    flag: "wx",
  });
  const began = Date.now();
  try {
    const config = modelConfig();
    const guarded: typeof fetch = async (input, options) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      const model =
        url.origin === config.endpoint.origin &&
        url.pathname === config.endpoint.pathname;
      const search =
        url.hostname === "restapi.amap.com" && url.pathname === "/v5/place/text";
      if (!model && !search) {
        throw new Error("Unexpected endpoint; no request sent.");
      }
      const kind = model ? "model" : "placeSearch";
      if (report.attempts[kind] >= maximumCalls[kind]) {
        throw new Error("Call limit reached; no request sent.");
      }
      report.attempts[kind] += 1;
      save();
      const response = await fetch(input, options);
      if (model) {
        report.model.httpStatus = response.status;
        const envelope = z
          .object({
            choices: z.array(
              z.object({
                finish_reason: z.string(),
                message: z.object({ content: z.string().nullable() }),
              }),
            ),
          })
          .safeParse(
            await response
              .clone()
              .json()
              .catch(() => null),
          );
        if (envelope.success && envelope.data.choices[0]) {
          const choice = envelope.data.choices[0];
          report.model.finishReason = ["stop", "length", "content_filter"].includes(
            choice.finish_reason,
          )
            ? choice.finish_reason
            : "other";
          report.model.contentCharacters = choice.message.content?.length ?? 0;
          const content = choice.message.content?.trim() ?? "";
          const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/i.exec(content);
          try {
            const outline = itineraryOutlineSchema.safeParse(
              JSON.parse(fenced?.[1] ?? content),
            );
            report.model.validOutline = outline.success;
            if (!outline.success) {
              const fields = new Set([
                "days",
                "guides",
                "title",
                "summary",
                "theme",
                "visits",
                "breakfast",
                "lunch",
                "dinner",
                "placeId",
                "reason",
                "stayMinutes",
                "dish",
                "experience",
                "tips",
                "highlights",
                "checkBeforeGo",
              ]);
              report.model.schemaIssues = outline.error.issues
                .slice(0, 8)
                .map((issue) => ({
                  code: issue.code,
                  path: issue.path.map((part) =>
                    typeof part === "number"
                      ? part
                      : fields.has(String(part))
                        ? part
                        : "field",
                  ),
                }));
            }
          } catch {
            report.model.validJson = false;
          }
        }
        save();
      }
      return response;
    };
    const provider = new AmapProvider(process.env.AMAP_WEB_SERVICE_KEY ?? "", guarded);
    const candidates: ItineraryCandidate[] = [];
    for (const [kind, query] of [
      ["visit", "博物馆"],
      ["restaurant", "本地特色餐厅"],
    ] as const) {
      const places = await provider.search("杭州", query);
      candidates.push(...places.map((place) => ({ place, kind, query })));
    }
    if (
      !candidates.some((item) => item.kind === "visit") ||
      !candidates.some((item) => item.kind === "restaurant")
    ) {
      throw new ProviderError(
        "unavailable",
        "No usable candidates; no model retry.",
        "no_place",
      );
    }
    const brief = tripBriefSchema.parse({
      destinationCity: "杭州",
      originCity: null,
      startDate: todayInShanghai(),
      dayCount: 1,
      travelers: 1,
      budget: {
        amountFen: 150000,
        basis: "per_person",
        includeIntercity: false,
        includeLodging: false,
      },
      availability: {
        firstDayStartMinute: 540,
        lastDayEndMinute: 1260,
        dailyStartMinute: 540,
        dailyEndMinute: 1260,
      },
      mainPurpose: "culture",
      secondaryPurposes: ["food"],
      pace: "balanced",
      mustVisit: [],
      mustEat: [],
      dietary: { avoid: [], allergies: [] },
    });
    const model = new OpenAiItineraryModel(config, guarded);
    const outline = await withAiBudget(() =>
      model.compose(brief, candidates, AbortSignal.timeout(70_000)),
    );
    const visits = outline.days.flatMap((day) => day.visits);
    const food = outline.days.flatMap((day) => [day.breakfast, day.lunch, day.dinner]);
    if (
      outline.days.length !== 1 ||
      new Set(visits.map((item) => item.placeId)).size !== visits.length ||
      visits.some(
        (item) =>
          !candidates.some(
            (candidate) =>
              candidate.kind === "visit" && candidate.place.id === item.placeId,
          ),
      ) ||
      food.some(
        (item) =>
          !candidates.some(
            (candidate) =>
              candidate.kind === "restaurant" && candidate.place.id === item.placeId,
          ),
      )
    ) {
      throw new ProviderError(
        "unavailable",
        "Invalid selection; no retry.",
        "ai_invalid_response",
      );
    }
    report.model.selectedVisits = visits.length;
    report.model.selectedMeals = food.length;
    report.model.guideCount = outline.guides?.length ?? 0;
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.publicErrorCode =
      error instanceof ProviderError && /^[a-z0-9_]{1,80}$/.test(error.code)
        ? error.code
        : "verification_failed";
    process.exitCode = 1;
  } finally {
    report.elapsedMs = Date.now() - began;
    save();
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(() => {
  console.error(
    "Verification stopped safely; no raw error or credentials printed. Do not repeat a live attempt.",
  );
  process.exitCode = 1;
});
