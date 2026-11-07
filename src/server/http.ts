import { AppError, httpStatusOf } from "./errors";

export function json(data: unknown, status = 200): Response {
  return Response.json(data, { status, headers: { "Cache-Control": "no-store" } });
}

/** 只接受本站页面发起的请求，防止他站盗用模型与地图配额 */
export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  if (!origin) {
    throw new AppError("forbidden", "请从本应用页面发起请求");
  }
  const target = new URL(request.url);
  const source = new URL(origin);
  const loopback = new Set(["localhost", "127.0.0.1"]);
  const sameLoopback =
    loopback.has(source.hostname) &&
    loopback.has(target.hostname) &&
    source.port === target.port;
  const forwardedHost =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (source.origin !== target.origin && !sameLoopback && source.host !== forwardedHost) {
    throw new AppError("forbidden", "不允许跨站请求");
  }
}

export async function readJson(request: Request, maxBytes: number): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) {
    throw new AppError("invalid_input", "请求需要 JSON 格式");
  }
  const body = await request.arrayBuffer();
  if (body.byteLength > maxBytes) {
    throw new AppError("invalid_input", "请求内容过大");
  }
  try {
    return JSON.parse(new TextDecoder().decode(body));
  } catch {
    throw new AppError("invalid_input", "JSON 内容无效");
  }
}

export function clientKey(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "local"
  );
}

export function errorResponse(error: unknown): Response {
  if (error instanceof AppError) {
    const response = json(
      { code: error.code, message: error.message },
      httpStatusOf(error),
    );
    if (error.retryAfterSeconds) {
      response.headers.set("Retry-After", String(error.retryAfterSeconds));
    }
    return response;
  }
  return json({ code: "unavailable", message: "服务暂时不可用，请稍后重试" }, 503);
}
