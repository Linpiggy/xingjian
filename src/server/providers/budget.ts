import { ProviderError } from "./errors";

// Local development safeguard, not a distributed production rate limiter.
let windowStarted = 0;
let used = 0;
let active = 0;
export function providerWaitMs(): number {
  const now = Date.now();
  if (used >= 60 && now - windowStarted < 60_000) {
    return 60_001 - (now - windowStarted);
  }
  return active >= 3 ? 25 : 0;
}
export async function withProviderBudget<T>(operation: () => Promise<T>): Promise<T> {
  const now = Date.now();
  if (now - windowStarted >= 60_000) {
    windowStarted = now;
    used = 0;
  }
  if (used >= 60 || active >= 3) {
    throw new ProviderError("unavailable", "请求较多，请稍后重试。", "rate_limited");
  }
  used += 1;
  active += 1;
  try {
    return await operation();
  } finally {
    active -= 1;
  }
}
