import { tripBriefSchema } from "@/lib/trip-brief-contracts";
import { api, json, readBody, requireSameOrigin } from "@/server/http";
import { configuredAmap } from "@/server/providers/configured-amap";
import { ProviderError } from "@/server/providers/errors";
import { modelConfig } from "@/server/ai/config";
import { OpenAiItineraryModel } from "@/server/ai/itinerary-model";
import { createItinerary } from "@/server/services/create-itinerary";
import type { ItineraryStage } from "@/domain/itinerary";

export async function POST(request: Request): Promise<Response> {
  return api(async () => {
    requireSameOrigin(request);
    const brief = tripBriefSchema.parse(await readBody(request));
    let config: ReturnType<typeof modelConfig>;
    try {
      config = modelConfig();
    } catch {
      return json(
        { code: "ai_not_configured", message: "AI 规划服务暂不可用，请稍后重试。" },
        503,
      );
    }
    if (!process.env.AMAP_WEB_SERVICE_KEY?.trim()) {
      return json(
        {
          code: "maps_not_configured",
          message: "地点与路线服务暂不可用，未生成替代的虚构方案。",
        },
        503,
      );
    }
    const cancel = new AbortController();
    const deadline = AbortSignal.timeout(240_000);
    const signal = AbortSignal.any([request.signal, cancel.signal, deadline]);
    let stage: ItineraryStage = "places";
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const send = (event: unknown) => {
          if (!request.signal.aborted && !cancel.signal.aborted) {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
        };
        try {
          const plan = await createItinerary(
            brief,
            configuredAmap(),
            new OpenAiItineraryModel(config),
            signal,
            (message, nextStage) => {
              stage = nextStage ?? stage;
              send({ type: "progress", message, stage });
            },
          );
          send({ type: "result", plan });
        } catch (error) {
          if (!request.signal.aborted && !cancel.signal.aborted) {
            const message = deadline.aborted
              ? "本次规划超过处理时限，未应用方案；请减少天数或稍后重试。"
              : error instanceof ProviderError && error.status !== "not_configured"
                ? error.message
                : "方案生成未完成，请检查需求后重试；原方案不会被覆盖。";
            const code = deadline.aborted
              ? "generation_timeout"
              : error instanceof ProviderError && /^[a-z0-9_]{1,60}$/.test(error.code)
                ? error.code
                : "unavailable";
            send({
              type: "error",
              message,
              code,
              stage: code.startsWith("ai_") ? "model" : stage,
              ...(error instanceof ProviderError && error.retryAfterSeconds
                ? { retryAfterSeconds: error.retryAfterSeconds }
                : {}),
            });
          }
        } finally {
          try {
            controller.close();
          } catch {
            /* A cancelled reader may already have closed the stream. */
          }
        }
      },
      cancel() {
        cancel.abort();
      },
    });
    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  });
}
