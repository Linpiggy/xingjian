export type MapFailure =
  "sdk_failed" | "sdk_timeout" | "basemap_timeout" | "initialization_failed";

export interface MapLifecycle {
  on(event: "complete", callback: () => void): void;
  off(event: "complete", callback: () => void): void;
  destroy(): void;
}

interface Options<Sdk, MapInstance extends MapLifecycle> {
  load: () => Promise<Sdk>;
  create: (sdk: Sdk) => MapInstance;
  onReady: (map: MapInstance, sdk: Sdk) => void;
  onFailure: (reason: MapFailure) => void;
  timeoutMs?: number;
}

// SDK availability does not mean the basemap is ready. Wait for the vendor's
// complete event, bound the entire initialization, and dispose stale attempts.
export function initializeMap<Sdk, MapInstance extends MapLifecycle>({
  load,
  create,
  onReady,
  onFailure,
  timeoutMs = 20_000,
}: Options<Sdk, MapInstance>): () => void {
  let stopped = false;
  let settled = false;
  let destroyed = false;
  let phase: "sdk" | "basemap" = "sdk";
  let map: MapInstance | undefined;
  let complete: (() => void) | undefined;

  function unsubscribe() {
    clearTimeout(timer);
    if (map && complete) {
      map.off("complete", complete);
    }
  }

  function destroy() {
    if (map && !destroyed) {
      destroyed = true;
      map.destroy();
    }
  }

  function fail(reason: MapFailure) {
    if (stopped || settled) {
      return;
    }
    settled = true;
    unsubscribe();
    destroy();
    onFailure(reason);
  }

  const timer = setTimeout(() => {
    fail(phase === "sdk" ? "sdk_timeout" : "basemap_timeout");
  }, timeoutMs);

  void Promise.resolve()
    .then(load)
    .then((sdk) => {
      if (stopped || settled) {
        return;
      }
      phase = "basemap";
      const instance = create(sdk);
      map = instance;
      complete = () => {
        if (stopped || settled) {
          return;
        }
        settled = true;
        unsubscribe();
        onReady(instance, sdk);
      };
      instance.on("complete", complete);
    })
    .catch(() => {
      fail(phase === "sdk" ? "sdk_failed" : "initialization_failed");
    });

  return () => {
    stopped = true;
    unsubscribe();
    destroy();
  };
}
