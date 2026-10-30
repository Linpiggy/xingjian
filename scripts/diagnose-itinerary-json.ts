// Explicit authorization only: at most three independent model-only attempts per day.
// node --import tsx scripts/diagnose-itinerary-json.ts --live --attempt=1 --days=3
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import nextEnv from "@next/env";
import { modelConfig } from "../src/server/ai/config";
import { OpenAiItineraryModel } from "../src/server/ai/itinerary-model";
import { ProviderError } from "../src/server/providers/errors";
import { fixtureBrief, fixtureCandidates } from "../tests/fixtures/itinerary";
import { parseItineraryOutput } from "../src/server/ai/itinerary-output";
import { todayInShanghai } from "../src/server/today";
import { fixtureSocialInspiration } from "../tests/fixtures/social";
import { jsonFailureSummary } from "../src/server/ai/model-json";

function syntaxSummary(error: unknown) {
  return error instanceof SyntaxError
    ? jsonFailureSummary(error)
    : { category: "schema_or_selection", offset: -1 };
}
async function main() {
  const attempt = Number(
    process.argv.find((value) => value.startsWith("--attempt="))?.split("=")[1],
  );
  const days = Number(
    process.argv.find((value) => value.startsWith("--days="))?.split("=")[1] ?? 3,
  );
  if (!process.argv.includes("--live")) {
    console.log(
      "Dry run: explicit --live and --attempt=1..3 required; no requests sent.",
    );
    return;
  }
  if (![1, 2, 3].includes(attempt) || !Number.isInteger(days) || days < 1 || days > 14) {
    throw new Error("Invalid diagnostic bounds");
  }
  nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
  const file = `docs/evidence/itinerary-json-diagnostic-${todayInShanghai()}-${attempt}.json`;
  if (existsSync(file)) {
    throw new Error("Attempt exists; do not overwrite or repeat");
  }
  const privateValues = [
    process.env.OPENAI_API_KEY,
    process.env.DEEPSEEK_API_KEY,
    process.env.AMAP_WEB_SERVICE_KEY,
    process.env.AMAP_JS_SECURITY_CODE,
  ].filter((value): value is string => Boolean(value));
  const report = {
    kind: "real_model_synthetic_candidate_format_diagnostic",
    checkedAt: new Date().toISOString(),
    attempt,
    status: "started",
    input: {
      days,
      candidates: 45,
      synthetic: true,
      socialFixture: process.argv.includes("--social-fixture"),
    },
    limits: { model: 1, places: 0, routes: 0, weather: 0, automaticRetries: 0 },
    modelCalls: 0,
    elapsedMs: 0,
    response: {} as Record<string, unknown>,
    errorCode: null as string | null,
    limitations: [
      "Synthetic inputs, not the user's failed request or a real city itinerary",
      "No raw content, credentials or supplier host retained",
      "No social retrieval, routing, UI or production rights verification",
    ],
  };
  function save() {
    const text = JSON.stringify(report, null, 2) + "\n";
    if (privateValues.some((value) => text.includes(value))) {
      throw new Error("Evidence contains private value");
    }
    writeFileSync(file, text, "utf8");
    if (readFileSync(file, "utf8") !== text) {
      throw new Error("Evidence verification failed");
    }
  }
  mkdirSync("docs/evidence", { recursive: true });
  writeFileSync(file, JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
    encoding: "utf8",
  });
  const start = Date.now();
  try {
    const config = modelConfig();
    const candidates = fixtureCandidates();
    const transport: typeof fetch = async (input, init) => {
      if (String(input) !== config.endpoint.href || report.modelCalls !== 0) {
        throw new Error("Unapproved target or repeated call");
      }
      report.modelCalls += 1;
      save();
      const response = await fetch(input, init);
      report.response.httpStatus = response.status;
      const contentType = response.headers.get("content-type") ?? "";
      report.response.contentType = /application\/json/i.test(contentType)
        ? "json"
        : /event-stream/i.test(contentType)
          ? "event_stream"
          : /text\/html/i.test(contentType)
            ? "html"
            : "other";
      const body = await response.clone().text();
      report.response.bodyCharacters = body.length;
      let envelope: unknown;
      try {
        envelope = JSON.parse(body);
        report.response.envelopeJson = true;
      } catch (error) {
        report.response.envelopeJson = false;
        report.response.envelopeError = syntaxSummary(error);
      }
      if (
        envelope &&
        typeof envelope === "object" &&
        "choices" in envelope &&
        Array.isArray(envelope.choices)
      ) {
        const item: unknown = envelope.choices[0];
        if (item && typeof item === "object") {
          if ("finish_reason" in item) {
            report.response.finishReason = ["stop", "length", "content_filter"].includes(
              String(item.finish_reason),
            )
              ? item.finish_reason
              : "other";
          }
          if (
            "message" in item &&
            item.message &&
            typeof item.message === "object" &&
            "content" in item.message &&
            typeof item.message.content === "string"
          ) {
            report.response.contentCharacters = item.message.content.length;
            try {
              const outline = parseItineraryOutput(item.message.content, candidates);
              report.response.validOutline = true;
              report.response.days = outline.days.length;
            } catch (error) {
              report.response.validOutline = false;
              report.response.contentError = syntaxSummary(error);
              // Preserve only punctuation at the failure boundary; never model text.
              const offset = syntaxSummary(error).offset;
              const character = item.message.content[offset];
              report.response.errorCharacter =
                character && /[{}\[\],:"\\`]/.test(character)
                  ? character
                  : "non_punctuation_or_end";
            }
          }
        }
      }
      save();
      return response;
    };
    const brief = fixtureBrief();
    brief.startDate = todayInShanghai();
    brief.dayCount = days;
    if (process.argv.includes("--social-fixture")) {
      brief.socialInspiration = fixtureSocialInspiration();
      brief.socialInspiration.notes[0].excerpt +=
        '\n测试引文：“先看展，再去吃饭”。英文引号 "quote"、反斜线 \\ 与换行均是测试数据。';
    }
    const outline = await new OpenAiItineraryModel(config, transport).compose(
      brief,
      candidates,
      AbortSignal.timeout(75_000),
    );
    if (outline.days.length !== days) {
      throw new Error("Day count mismatch");
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.errorCode = error instanceof ProviderError ? error.code : "diagnostic_failed";
    process.exitCode = 1;
  } finally {
    report.elapsedMs = Date.now() - start;
    save();
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(() => {
  console.error(
    "Diagnostic stopped; no raw error or credentials printed. Do not repeat an existing attempt.",
  );
  process.exitCode = 1;
});
