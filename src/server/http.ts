import { z } from "zod";
import { ProviderError } from "./providers/errors";

class InputError extends Error {}
export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}
export function requireSameOrigin(request: Request): void {
  const value = request.headers.get("origin");
  if (!value) {
    throw new InputError("请从本应用页面发起请求。");
  }

  let origin: URL;
  try {
    origin = new URL(value);
  } catch {
    throw new InputError("请求来源无效。");
  }

  const target = new URL(request.url);
  const loopbackHosts = new Set(["localhost", "127.0.0.1"]);
  const sameLoopbackEndpoint =
    loopbackHosts.has(origin.hostname) &&
    loopbackHosts.has(target.hostname) &&
    origin.protocol === target.protocol &&
    origin.port === target.port;

  // Next.js canonicalizes local request URLs to localhost. Only recognize
  // the two loopback aliases on the same scheme/port, never arbitrary hosts.
  if (
    value !== origin.origin ||
    (origin.origin !== target.origin && !sameLoopbackEndpoint)
  ) {
    throw new InputError("请从本应用页面发起请求。");
  }
}
export async function readBody(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new InputError("请求需要 JSON 格式。");
  }
  const reader = request.body?.getReader();
  if (!reader) {
    throw new InputError("请求内容为空。");
  }
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        break;
      }
      bytes += next.value.length;
      if (bytes > 16_384) {
        await reader.cancel();
        throw new InputError("请求内容过大。");
      }
      chunks.push(next.value);
    }
    const merged = new Uint8Array(bytes);
    let cursor = 0;
    for (const chunk of chunks) {
      merged.set(chunk, cursor);
      cursor += chunk.length;
    }
    return JSON.parse(new TextDecoder().decode(merged));
  } catch (error) {
    if (error instanceof InputError) {
      throw error;
    }
    throw new InputError("JSON 内容无效。");
  }
}
export async function api(operation: () => Promise<Response>): Promise<Response> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof z.ZodError) {
      return json(
        { code: "invalid_input", message: error.issues[0]?.message ?? "输入无效。" },
        400,
      );
    }
    if (error instanceof InputError) {
      return json({ code: "invalid_request", message: error.message }, 400);
    }
    if (error instanceof ProviderError) {
      const status =
        error.status === "not_configured"
          ? 503
          : [
                "rate_limited",
                "amap_rate_limited",
                "ai_rate_limited",
                "ai_local_rate_limited",
                "ai_cooldown",
              ].includes(error.code)
            ? 429
            : ["generation_busy", "ai_busy"].includes(error.code)
              ? 409
              : ["no_place", "duplicate_place"].includes(error.code)
                ? 422
                : 502;
      const response = json(
        {
          code: error.code,
          message: error.message,
          providerStatus: error.status,
          ...(error.retryAfterSeconds
            ? { retryAfterSeconds: error.retryAfterSeconds }
            : {}),
        },
        status,
      );
      if (error.retryAfterSeconds) {
        response.headers.set("Retry-After", String(error.retryAfterSeconds));
      }
      return response;
    }
    // Never serialize supplier URLs, secrets, raw responses or private stack traces.
    return json({ code: "unavailable", message: "服务暂时不可用，请稍后重试。" }, 503);
  }
}
