/** POST /api/vision —— 拍照识景：识别照片中的地点与风格，返回规划建议 */
import { z } from "zod";
import { assertSafe } from "@/server/agent/guard";
import { AppError } from "@/server/errors";
import {
  assertSameOrigin,
  clientKey,
  errorResponse,
  json,
  readJson,
} from "@/server/http";
import { analyzePhoto } from "@/server/llm/vision";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 90;

const inputSchema = z.object({
  image: z
    .string()
    .max(6_000_000, "图片太大，请换一张")
    .regex(
      /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/,
      "只支持 JPG、PNG、WebP 图片",
    ),
});

const WINDOW_MS = 10 * 60_000;
const LIMIT = 10;
const history = new Map<string, number[]>();

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const parsed = inputSchema.safeParse(await readJson(request, 6_500_000));
    if (!parsed.success) {
      throw new AppError("invalid_input", parsed.error.issues[0]?.message ?? "图片无效");
    }
    const client = clientKey(request);
    const now = Date.now();
    const recent = (history.get(client) ?? []).filter((time) => now - time < WINDOW_MS);
    if (recent.length >= LIMIT) {
      throw new AppError("rate_limited", "识别次数太多了，请稍后再试", 60);
    }
    history.set(client, [...recent, now]);
    const insight = await analyzePhoto(parsed.data.image, request.signal);
    // 模型输出也做一次内容安全检查
    assertSafe(`${insight.scene} ${insight.note} ${insight.place ?? ""}`);
    return json({ insight });
  } catch (error) {
    return errorResponse(error);
  }
}
