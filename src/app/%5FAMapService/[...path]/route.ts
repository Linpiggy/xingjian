import { api, json, requireSameOrigin } from "@/server/http";
import { withProviderBudget } from "@/server/providers/budget";

export async function GET(
  request: Request,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  return api(async () => {
    const key = process.env.NEXT_PUBLIC_AMAP_JS_KEY;
    const security = process.env.AMAP_JS_SECURITY_CODE;
    if (!key || !security) {
      return json(
        { code: "not_configured", message: "地图 JS Key 或安全密钥未配置。" },
        503,
      );
    }
    const { path } = await context.params;
    const route = path.join("/");
    if (
      !/^v[345]\/[a-zA-Z0-9_\/-]+$/.test(route) ||
      route.length > 160 ||
      request.url.length > 8192
    ) {
      return json({ code: "invalid_path", message: "不支持的地图请求。" }, 400);
    }
    const requestUrl = new URL(request.url);
    let trustedOrigin = true;
    if (request.headers.has("origin")) {
      try {
        requireSameOrigin(request);
      } catch {
        trustedOrigin = false;
      }
    }
    if (!trustedOrigin || request.headers.get("sec-fetch-site") === "cross-site") {
      return json({ code: "forbidden", message: "不允许跨站地图请求。" }, 403);
    }
    // Fixed upstream hosts only. No arbitrary target URL, credential/header forwarding or redirects.
    const upstream = new URL(
      route,
      route === "v4/map/styles"
        ? "https://webapi.amap.com/"
        : "https://restapi.amap.com/",
    );
    upstream.search = requestUrl.search;
    upstream.searchParams.set("key", key);
    upstream.searchParams.set("jscode", security);
    return withProviderBudget(async () => {
      const response = await fetch(upstream, {
        cache: "no-store",
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      const body = await response.arrayBuffer();
      if (body.byteLength > 3_000_000) {
        return json({ code: "unavailable", message: "地图响应过大。" }, 502);
      }
      return new Response(body, {
        status: response.status,
        headers: {
          "Cache-Control": "no-store",
          "Content-Type": response.headers.get("content-type") ?? "application/json",
        },
      });
    });
  });
}
