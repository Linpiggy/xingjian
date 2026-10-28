import type { TripBrief } from "@/domain/trip-brief";
import type { Itinerary, ItineraryStage } from "@/domain/itinerary";
import { itineraryEventSchema, planningFailureSchema } from "@/lib/itinerary-contracts";
import { tripBriefSchema } from "@/lib/trip-brief-contracts";

export class PlanningRequestError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly stage: ItineraryStage | null = null,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

export async function requestItinerary(
  brief: TripBrief,
  signal: AbortSignal,
  onProgress: (message: string, stage?: ItineraryStage) => void,
  transport: typeof fetch = fetch,
): Promise<Itinerary> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
  try {
    const response = await transport("/api/itineraries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(brief),
      signal: combined,
    });
    if (!response.ok) {
      const data = planningFailureSchema.safeParse(
        await response.json().catch(() => null),
      );
      if (data.success) {
        throw new PlanningRequestError(
          data.data.message,
          data.data.code,
          data.data.stage,
          data.data.retryAfterSeconds,
        );
      }
      throw new PlanningRequestError(
        response.status === 429
          ? "请求暂时受限，请稍后再试；原方案保持不变。"
          : "规划服务暂不可用，请稍后重试；原方案保持不变。",
        response.status === 429 ? "rate_limited" : "service_unavailable",
      );
    }
    const reader = response.body?.getReader();
    if (!reader) {
      throw new PlanningRequestError("规划响应为空，原方案保持不变。", "empty_response");
    }
    const decoder = new TextDecoder();
    let buffer = "";
    let bytes = 0;
    let result: Itinerary | null = null;
    try {
      while (true) {
        combined.throwIfAborted();
        const next = await reader.read();
        if (next.value) {
          bytes += next.value.byteLength;
          buffer += decoder.decode(next.value, { stream: !next.done });
        }
        if (bytes > 2_000_000) {
          throw new PlanningRequestError(
            "规划响应过大，未使用不完整数据。",
            "response_too_large",
          );
        }
        if (next.done) {
          buffer += decoder.decode();
        }
        const lines = buffer.split("\n");
        buffer = next.done ? "" : lines.pop()!;
        for (const line of lines) {
          if (!line.trim()) {
            continue;
          }
          let data: unknown;
          try {
            data = JSON.parse(line);
          } catch {
            throw new PlanningRequestError(
              "规划响应格式异常，未使用无效方案。",
              "invalid_response",
            );
          }
          const parsed = itineraryEventSchema.safeParse(data);
          if (!parsed.success) {
            throw new PlanningRequestError(
              "规划响应格式异常，未使用无效方案。",
              "invalid_response",
            );
          }
          const event = parsed.data;
          combined.throwIfAborted();
          if (event.type === "progress") {
            if (event.stage) {
              onProgress(event.message, event.stage);
            } else {
              onProgress(event.message);
            }
          }
          if (event.type === "error") {
            throw new PlanningRequestError(
              event.message,
              event.code,
              event.stage,
              event.retryAfterSeconds,
            );
          }
          if (event.type === "result") {
            if (result) {
              throw new PlanningRequestError(
                "规划返回了重复结果，未应用方案。",
                "duplicate_result",
              );
            }
            if (
              JSON.stringify(event.plan.brief) !==
              JSON.stringify(tripBriefSchema.parse(brief))
            ) {
              throw new PlanningRequestError(
                "方案需求与本次请求不一致，未应用旧结果。",
                "request_mismatch",
              );
            }
            result = event.plan;
          }
        }
        if (next.done) {
          break;
        }
      }
    } finally {
      await reader.cancel().catch(() => undefined);
    }
    combined.throwIfAborted();
    if (!result) {
      throw new PlanningRequestError(
        "方案生成未完成，请重试；原方案保持不变。",
        "incomplete_response",
      );
    }
    return result;
  } catch (error) {
    signal.throwIfAborted();
    if (combined.aborted) {
      throw new PlanningRequestError(
        "本次规划等待超时，未应用方案；请稍后重试或减少天数。",
        "request_timeout",
      );
    }
    if (error instanceof PlanningRequestError) {
      throw error;
    }
    throw new PlanningRequestError(
      "规划连接中断，请检查网络后重试；原方案保持不变。",
      "network_error",
    );
  }
}
