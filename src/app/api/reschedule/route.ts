/**
 * POST /api/reschedule —— 用户手动调整某一天（换顺序、替换、删除、改时长）后重新排程。
 * 不调用大模型：只重算真实路线、时刻和预算，几秒内返回。
 */
import { rescheduleInputSchema, type Trip } from "@/lib/schema";
import { buildDay, dayToDraft, recomputeBudget } from "@/server/agent/enrich";
import { AgentSession } from "@/server/agent/session";
import { AppError } from "@/server/errors";
import {
  assertSameOrigin,
  clientKey,
  errorResponse,
  json,
  readJson,
} from "@/server/http";
import { amapFromEnv } from "@/server/providers/amap";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const WINDOW_MS = 60_000;
const LIMIT = 30;
const recent = new Map<string, number[]>();

function rateLimit(client: string) {
  const now = Date.now();
  const list = (recent.get(client) ?? []).filter((time) => now - time < WINDOW_MS);
  if (list.length >= LIMIT) {
    throw new AppError("rate_limited", "操作太频繁，请稍后再试", 30);
  }
  list.push(now);
  recent.set(client, list);
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const parsed = rescheduleInputSchema.safeParse(await readJson(request, 2_000_000));
    if (!parsed.success) {
      throw new AppError("invalid_input", parsed.error.issues[0]?.message ?? "输入无效");
    }
    rateLimit(clientKey(request));
    const { request: tripRequest, trip, day, stops, label } = parsed.data;
    const original = trip.days.find((item) => item.day === day);
    if (!original) {
      throw new AppError("invalid_input", "找不到要调整的那一天");
    }

    // 只允许使用行程里已有的地点或 Agent 检索过的候选，防止请求被篡改为任意坐标
    const known = new Set([
      ...trip.days.flatMap((item) => item.stops.map((stop) => stop.place.id)),
      ...trip.candidates.map((place) => place.id),
    ]);
    if (stops.some((stop) => !known.has(stop.place.id))) {
      throw new AppError("invalid_input", "包含未知地点，请刷新后重试");
    }

    const session = new AgentSession(tripRequest, amapFromEnv(), () => undefined, trip);
    session.register(stops.map((stop) => stop.place));
    const draft = dayToDraft({ ...original, stops });
    const rebuilt = await buildDay(session, draft);

    const usedNow = new Set(stops.map((stop) => stop.place.id));
    const released = original.stops
      .map((stop) => stop.place)
      .filter((place) => !usedNow.has(place.id) && place.category !== "hotel");
    const next: Trip = {
      ...trip,
      days: trip.days.map((item) => (item.day === day ? rebuilt : item)),
      candidates: [
        ...trip.candidates.filter((place) => !usedNow.has(place.id)),
        ...released.filter((place) => !trip.candidates.some((c) => c.id === place.id)),
      ].slice(0, 80),
      changeSummary: label,
      generatedAt: new Date().toISOString(),
    };
    next.budget = recomputeBudget(next, tripRequest.travelers);
    return json({ trip: next });
  } catch (error) {
    return errorResponse(error);
  }
}
