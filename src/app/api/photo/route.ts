/**
 * GET /api/photo?url=... —— 高德 POI 图片同源代理。
 * 高德图片服务不返回 CORS 头，直接画进 Canvas 会污染画布导致长图无法导出；
 * 经同源代理后可安全绘制。只允许 https 的高德域名、只转发图片、限制体积，杜绝被当作通用代理。
 */
import { isAllowedPhoto } from "@/lib/photo";
import { json } from "@/server/http";

export const runtime = "nodejs";

const MAX_BYTES = 5 * 1024 * 1024;

export async function GET(request: Request): Promise<Response> {
  const target = isAllowedPhoto(new URL(request.url).searchParams.get("url") ?? "");
  if (!target) {
    return json({ code: "invalid_input", message: "不支持的图片地址" }, 400);
  }
  try {
    const upstream = await fetch(target, {
      redirect: "error",
      signal: AbortSignal.timeout(8000),
      headers: { Accept: "image/*" },
    });
    const type = upstream.headers.get("content-type") ?? "";
    if (!upstream.ok || !type.startsWith("image/")) {
      return json({ code: "upstream", message: "图片不可用" }, 502);
    }
    const body = await upstream.arrayBuffer();
    if (body.byteLength > MAX_BYTES) {
      return json({ code: "upstream", message: "图片过大" }, 502);
    }
    return new Response(body, {
      headers: {
        "Content-Type": type,
        "Cache-Control": "public, max-age=86400, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return json({ code: "upstream", message: "图片加载失败" }, 502);
  }
}
