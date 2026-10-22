import { ProviderError } from "@/server/providers/errors";

let active = false;
let started: number[] = [];
export async function withAiBudget<T>(operation: () => Promise<T>): Promise<T> {
  const now = Date.now();
  started = started.filter((time) => now - time < 60_000);
  if (active || started.length >= 3) {
    throw new ProviderError("unavailable", "AI 请求较多，请稍后重试。", "rate_limited");
  }
  active = true;
  started.push(now);
  try {
    return await operation();
  } finally {
    active = false;
  }
}
