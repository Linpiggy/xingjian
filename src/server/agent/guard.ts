/**
 * AI 安全与可控性：
 * 1. 输入侧：违规意图拦截、提示词注入识别（只当作普通文本，不执行）
 * 2. 输出侧：清理模型文本中的链接、控制字符，限制长度
 * 3. 运行侧：按客户端限流、全局并发上限，保护模型与地图配额
 */
import type { TripRequest } from "@/lib/schema";
import { AppError } from "@/server/errors";

const BLOCKED = [
  /毒品|冰毒|大麻|海洛因/,
  /枪支|弹药|炸药|爆炸物/,
  /偷渡|走私|非法越境/,
  /赌场.*(代理|洗钱)|洗钱/,
  /色情|嫖娼|卖淫/,
];

const INJECTION = [
  /忽略(之前|以上|前面|所有)的?(指令|提示|要求)/,
  /ignore (all |the )?(previous|above) (instructions|prompts?)/i,
  /system\s*prompt|系统提示词/i,
  /你现在是|扮演|jailbreak|developer mode/i,
];

export function userText(request: TripRequest, extra = ""): string {
  return [request.mustSee, request.foodPreference, request.notes, extra].join("\n");
}

export function assertSafe(text: string): void {
  if (BLOCKED.some((pattern) => pattern.test(text))) {
    throw new AppError(
      "unsafe_input",
      "需求中包含违法或不适宜的内容，行间无法协助。请调整后重试。",
    );
  }
}

export function looksLikeInjection(text: string): boolean {
  return INJECTION.some((pattern) => pattern.test(text));
}

/** 模型输出不得包含外链或可执行内容，统一去除 */
export function cleanText(value: string): string {
  return value
    .replace(/https?:\/\/\S+/gi, "")
    .replace(/www\.\S+/gi, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function cleanList(values: string[]): string[] {
  return values.map(cleanText).filter(Boolean);
}

const WINDOW_MS = 10 * 60_000;
const PER_CLIENT_LIMIT = 8;
const GLOBAL_CONCURRENCY = 3;
const history = new Map<string, number[]>();
const activeClients = new Set<string>();

/** 进程内限流（单实例部署足够；多实例需换成共享存储） */
export function acquireSlot(client: string): () => void {
  const now = Date.now();
  const recent = (history.get(client) ?? []).filter((time) => now - time < WINDOW_MS);
  if (activeClients.has(client)) {
    throw new AppError("busy", "你已有一份行程正在生成，请等待完成或取消后再试。");
  }
  if (activeClients.size >= GLOBAL_CONCURRENCY) {
    throw new AppError("busy", "当前使用人数较多，请稍后再试。", 20);
  }
  if (recent.length >= PER_CLIENT_LIMIT) {
    const wait = Math.ceil((recent[0] + WINDOW_MS - now) / 1000);
    throw new AppError("rate_limited", `请求过于频繁，请 ${wait} 秒后再试。`, wait);
  }
  recent.push(now);
  history.set(client, recent);
  activeClients.add(client);
  return () => {
    activeClients.delete(client);
  };
}
