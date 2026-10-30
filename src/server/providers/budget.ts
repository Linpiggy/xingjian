import { ProviderError } from "./errors";

// Local development safeguard, not a distributed production rate limiter. The server
// Web service key and the browser JS key have separate quotas, so they also keep
// separate windows: an open map must never starve an ongoing plan.
function limiter(perMinute: number, concurrent: number) {
  let windowStarted = 0;
  let used = 0;
  let active = 0;
  return {
    waitMs(): number {
      const now = Date.now();
      if (used >= perMinute && now - windowStarted < 60_000) {
        return 60_001 - (now - windowStarted);
      }
      return active >= concurrent ? 25 : 0;
    },
    async run<T>(operation: () => Promise<T>): Promise<T> {
      const now = Date.now();
      if (now - windowStarted >= 60_000) {
        windowStarted = now;
        used = 0;
      }
      if (used >= perMinute || active >= concurrent) {
        throw new ProviderError("unavailable", "请求较多，请稍后重试。", "rate_limited");
      }
      used += 1;
      active += 1;
      try {
        return await operation();
      } finally {
        active -= 1;
      }
    },
  };
}

const webService = limiter(60, 3);
// The JS SDK issues bursts of service calls while the map loads, pans and zooms.
const mapProxy = limiter(120, 8);

export const providerWaitMs = (): number => webService.waitMs();
export const withProviderBudget = <T>(operation: () => Promise<T>): Promise<T> =>
  webService.run(operation);
export const mapProxyWaitMs = (): number => mapProxy.waitMs();
export const withMapProxyBudget = <T>(operation: () => Promise<T>): Promise<T> =>
  mapProxy.run(operation);
