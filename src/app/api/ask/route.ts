/** POST /api/ask —— 行前问答，NDJSON 流式返回回答文本、工具调用与来源 */
import { askInputSchema, type AskEvent } from "@/lib/schema";
import { runAsk } from "@/server/agent/ask-agent";
import { acquireSlot } from "@/server/agent/guard";
import { AppError } from "@/server/errors";
import { assertSameOrigin, clientKey, errorResponse, readJson } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function POST(request: Request): Promise<Response> {
  let release: (() => void) | null = null;
  try {
    assertSameOrigin(request);
    const parsed = askInputSchema.safeParse(await readJson(request, 2_000_000));
    if (!parsed.success) {
      throw new AppError("invalid_input", parsed.error.issues[0]?.message ?? "输入无效");
    }
    release = acquireSlot(clientKey(request));
    const finish = release;
    release = null;
    const input = parsed.data;
    const encoder = new TextEncoder();
    const controller = new AbortController();
    request.signal.addEventListener("abort", () => controller.abort());

    const stream = new ReadableStream<Uint8Array>({
      async start(sink) {
        const emit = (event: AskEvent) => {
          if (!controller.signal.aborted) {
            sink.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          }
        };
        try {
          await runAsk(input, emit, controller.signal);
          emit({ type: "done" });
        } catch (error) {
          if (!controller.signal.aborted) {
            const known = error instanceof AppError;
            emit({
              type: "error",
              code: known ? error.code : "unavailable",
              message: known ? error.message : "回答时出现异常，请稍后重试",
            });
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
