"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/** 本地存储只在浏览器可用；服务端渲染阶段返回 false，避免水合不一致 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
