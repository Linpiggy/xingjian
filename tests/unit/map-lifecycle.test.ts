import { afterEach, describe, expect, it, vi } from "vitest";
import { initializeMap, type MapLifecycle } from "@/features/map/initialize-map";

afterEach(() => {
  vi.useRealTimers();
});

function fixture() {
  vi.useFakeTimers();
  const callbacks = new Set<() => void>();
  const map: MapLifecycle = {
    on: vi.fn((_event, callback) => {
      callbacks.add(callback);
    }),
    off: vi.fn((_event, callback) => {
      callbacks.delete(callback);
    }),
    destroy: vi.fn(),
  };
  const sdk = { kind: "fixture" };
  const load = vi.fn<() => Promise<typeof sdk>>().mockResolvedValue(sdk);
  const create = vi.fn(() => map);
  const onReady = vi.fn();
  const onFailure = vi.fn();
  return { map, sdk, callbacks, load, create, onReady, onFailure, timeoutMs: 1000 };
}

describe("map initialization lifecycle (mock SDK, no network)", () => {
  it("waits for basemap completion, then cleans up exactly once", async () => {
    const options = fixture();
    const stop = initializeMap(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.create).toHaveBeenCalledOnce();
    expect(options.onReady).not.toHaveBeenCalled();
    for (const callback of options.callbacks) {
      callback();
    }
    expect(options.onReady).toHaveBeenCalledWith(options.map, options.sdk);
    expect(options.callbacks.size).toBe(0);
    await vi.advanceTimersByTimeAsync(2000);
    expect(options.onFailure).not.toHaveBeenCalled();
    stop();
    stop();
    expect(options.map.destroy).toHaveBeenCalledOnce();
  });

  it("bounds an unresolved SDK request", async () => {
    const options = fixture();
    options.load.mockImplementation(() => new Promise(() => {}));
    const stop = initializeMap(options);
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.onFailure).toHaveBeenCalledWith("sdk_timeout");
    expect(options.create).not.toHaveBeenCalled();
    stop();
  });

  it("fails when the SDK loads but the basemap never completes", async () => {
    const options = fixture();
    const stop = initializeMap(options);
    await vi.advanceTimersByTimeAsync(0);
    const lateCallback = [...options.callbacks][0];
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.onFailure).toHaveBeenCalledWith("basemap_timeout");
    expect(options.map.destroy).toHaveBeenCalledOnce();
    expect(options.callbacks.size).toBe(0);
    lateCallback();
    expect(options.onReady).not.toHaveBeenCalled();
    stop();
    expect(options.map.destroy).toHaveBeenCalledOnce();
  });

  it("reports SDK failure without exposing a raw vendor error", async () => {
    const options = fixture();
    options.load.mockRejectedValue(new Error("fixture-private-vendor-error"));
    const stop = initializeMap(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onFailure).toHaveBeenCalledWith("sdk_failed");
    expect(options.onFailure.mock.calls).toEqual([["sdk_failed"]]);
    expect(options.create).not.toHaveBeenCalled();
    stop();
  });

  it("ignores an SDK result arriving after unmount", async () => {
    const options = fixture();
    let resolve: (sdk: typeof options.sdk) => void = () => {};
    options.load.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    const stop = initializeMap(options);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    resolve(options.sdk);
    await vi.advanceTimersByTimeAsync(1000);
    expect(options.create).not.toHaveBeenCalled();
    expect(options.onReady).not.toHaveBeenCalled();
    expect(options.onFailure).not.toHaveBeenCalled();
  });

  it("distinguishes constructor failure from a missing SDK", async () => {
    const options = fixture();
    options.create.mockImplementation(() => {
      throw new Error("fixture-constructor-error");
    });
    const stop = initializeMap(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.onFailure).toHaveBeenCalledWith("initialization_failed");
    expect(options.onReady).not.toHaveBeenCalled();
    stop();
  });
});
