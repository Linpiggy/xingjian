/**
 * 高德 JS API 安全密钥代理：浏览器地图 SDK 的服务请求经由本路由转发，
 * 在服务端追加 jscode，安全密钥不会暴露到前端代码中。
 */
import { assertSameOrigin, errorResponse, json } from "@/server/http";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY;
  const security = process.env.AMAP_JS_SECURITY_CODE;
  if (!key || !security) {
    return json({ code: "not_configured", message: "地图 JS Key 未配置" }, 503);
  }
  try {
    if (request.headers.has("origin")) {
      assertSameOrigin(request);
    }
  } catch (error) {
    return errorResponse(error);
  }
  const { path } = await context.params;
  const route = path.join("/");
  if (!/^v[345]\/[a-zA-Z0-9_/-]+$/.test(route) || route.length > 160) {
    return json({ code: "invalid_input", message: "不支持的地图请求" }, 400);
  }
  const upstream = new URL(
    route,
    route === "v4/map/styles" ? "https://webapi.amap.com/" : "https://restapi.amap.com/",
  );
  upstream.search = new URL(request.url).search;
  upstream.searchParams.set("jscode", security);
  try {
    const response = await fetch(upstream, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    return new Response(await response.arrayBuffer(), {
      status: response.status,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": response.headers.get("content-type") ?? "application/json",
      },
    });
  } catch {
    return json({ code: "upstream", message: "地图服务暂不可用" }, 502);
  }
}
