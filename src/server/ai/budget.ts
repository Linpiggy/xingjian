import { ProviderError } from "@/server/providers/errors";

let planning = false;
let active = false;
let started: number[] = [];
let blockedUntil = 0;

// Duplicate planning jobs are separate from actual model attempt accounting.
export async function withItineraryBudget<T>(operation: () => Promise<T>): Promise<T> {
  if (planning) {
    throw new ProviderError(
      "unavailable",
      "已有一份规划正在处理，请等待完成或取消后再试；本次未调用模型。",
      "generation_busy",
    );
  }
  assertAiAvailable();
  planning = true;
  try {
    return await operation();
  } finally {
    planning = false;
  }
}

// Single-process safeguard. Count only the model attempt, never POI searches or routing.
function assertAiAvailable(): void {
  const now = Date.now();
  started = started.filter((time) => now - time < 60_000);
  if (blockedUntil > now) {
    const seconds = Math.ceil((blockedUntil - now) / 1000);
    throw new ProviderError(
      "unavailable",
      `模型服务先前限流，请等待 ${seconds} 秒后再试；未发起新模型请求。`,
      "ai_cooldown",
      seconds,
    );
  }
  if (active) {
    throw new ProviderError(
      "unavailable",
      "AI 正在处理其他请求，请等待完成后再试。",
      "ai_busy",
    );
  }
  if (started.length >= 3) {
    const seconds = Math.max(1, Math.ceil((started[0] + 60_000 - now) / 1000));
    throw new ProviderError(
      "unavailable",
      `本地模型请求保护生效，请等待 ${seconds} 秒后再试；未发起新模型请求。`,
      "ai_local_rate_limited",
      seconds,
    );
  }
}

// 修补重试也要计入同一分钟限额，避免静默多计费而不受限
export function noteModelAttempt(): void {
  started.push(Date.now());
}

export async function withAiBudget<T>(operation: () => Promise<T>): Promise<T> {
  assertAiAvailable();
  active = true;
  started.push(Date.now());
  try {
    return await operation();
  } catch (error) {
    if (
      error instanceof ProviderError &&
      ["ai_rate_limited", "rate_limited"].includes(error.code)
    ) {
      const seconds = error.retryAfterSeconds ?? 60;
      blockedUntil = Date.now() + Math.min(3600, Math.max(1, seconds)) * 1000;
    }
    throw error;
  } finally {
    active = false;
  }
}
