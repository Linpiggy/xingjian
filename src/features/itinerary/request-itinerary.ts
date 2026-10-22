import type { TripBrief } from "@/domain/trip-brief";
import type { Itinerary } from "@/domain/itinerary";
import { itineraryEventSchema } from "@/lib/itinerary-contracts";
import { tripBriefSchema } from "@/lib/trip-brief-contracts";

export async function requestItinerary(
  brief: TripBrief,
  signal: AbortSignal,
  onProgress: (message: string) => void,
  transport: typeof fetch = fetch,
): Promise<Itinerary> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(240_000)]);
  const response = await transport("/api/itineraries", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(brief),
    signal: combined,
  });
  if (!response.ok) {
    const data: unknown = await response.json();
    throw new Error(
      typeof data === "object" &&
        data !== null &&
        "message" in data &&
        typeof data.message === "string"
        ? data.message
        : "方案生成失败，请稍后重试。",
    );
  }
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("规划响应为空，原方案保持不变。");
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
        throw new Error("规划响应过大，未使用不完整数据。");
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
          throw new Error("规划响应格式异常，未使用无效方案。");
        }
        const parsed = itineraryEventSchema.safeParse(data);
        if (!parsed.success) {
          throw new Error("规划响应格式异常，未使用无效方案。");
        }
        const event = parsed.data;
        combined.throwIfAborted();
        if (event.type === "progress") {
          onProgress(event.message);
        }
        if (event.type === "error") {
          throw new Error(event.message);
        }
        if (event.type === "result") {
          if (result) {
            throw new Error("规划返回了重复结果，未应用方案。");
          }
          if (
            JSON.stringify(event.plan.brief) !==
            JSON.stringify(tripBriefSchema.parse(brief))
          ) {
            throw new Error("方案需求与本次请求不一致，未应用旧结果。");
          }
          result = event.plan;
        }
      }
      if (next.done) {
        break;
      }
    }
  } finally {
    await reader.cancel();
  }
  combined.throwIfAborted();
  if (!result) {
    throw new Error("方案生成未完成，请重试；原方案保持不变。");
  }
  return result;
}
