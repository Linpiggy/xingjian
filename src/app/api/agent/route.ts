/**
 * POST /api/agent —— 启动规划 / 调整 Agent，以 NDJSON 流式返回事件。
 * 选择 NDJSON 而不是 SSE：请求需要 POST 大体积 JSON，fetch + ReadableStream 解析更直接。
 */
import { agentInputSchema, type AgentEvent } from "@/lib/schema";
import { acquireSlot } from "@/server/agent/guard";
import { runAgent } from "@/server/agent/run-agent";
import { AppError } from "@/server/errors";
import { assertSameOrigin, clientKey, errorResponse, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request): Promise<Response> {
  let release: (() => void) | null = null;
  try {
    assertSameOrigin(request);
    const body = await readJson(request, 2_000_000);
    const parsed = agentInputSchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError("invalid_input", parsed.error.issues[0]?.message ?? "输入无效");
    }
    release = acquireSlot(clientKey(request));
    const input = parsed.data;
    const finish = release;
    release = null;

    const encoder = new TextEncoder();
    const controller = new AbortController();
    request.signal.addEventListener("abort", () => controller.abort());

    const stream = new ReadableStream<Uint8Array>({
      async start(sink) {
        const emit = (event: AgentEvent) => {
          if (!controller.signal.aborted) {
            sink.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
        };
        try {
          await runAgent(input, emit, controller.signal);
          emit({ type: "done" });
        } catch (error) {
          if (!controller.signal.aborted) {
            const known = error instanceof AppError;
            emit({
              type: "error",
              code: known ? error.code : "unavailable",
              message: known ? error.message : "规划过程中出现异常，请稍后重试",
            });
            if (!known) {
              console.error(
                "[agent] unexpected failure",
                error instanceof Error ? error.message : error,
              );
            }
          }
        } finally {
          finish();
          try {
            sink.close();
          } catch {
            // 客户端已断开
          }
        }
      },
      cancel() {
        controller.abort();
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (error) {
    release?.();
    return errorResponse(error);
  }
}
