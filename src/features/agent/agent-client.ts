/**
 * 前端 Agent 客户端：POST /api/agent，逐行解析 NDJSON 并把事件分发到 store。
 * 用模块级 Map 记录运行中的请求，避免 React 严格模式重复挂载导致发起两次规划。
 */
"use client";

import type { AgentEvent, AgentInput } from "@/lib/schema";
import { useTrips } from "@/store/trips";

const running = new Map<string, AbortController>();

export function isRunning(id: string): boolean {
  return running.has(id);
}

export async function startAgent(id: string, input: AgentInput): Promise<void> {
  if (running.has(id)) {
    return;
  }
  const controller = new AbortController();
  running.set(id, controller);
  const store = useTrips.getState();
  store.beginRun(id, input.mode, input.mode === "revise" ? input.instruction : undefined);
  let finished = false;
  try {
    const response = await fetch("/api/agent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      const body = (await response.json().catch(() => null)) as {
        message?: string;
      } | null;
      throw new Error(body?.message ?? `请求失败（HTTP ${response.status}）`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const dispatch = (line: string) => {
      if (!line.trim()) {
        return;
      }
      const event = JSON.parse(line) as AgentEvent;
      if (event.type === "trip" || event.type === "error") {
        finished = true;
      }
      useTrips.getState().applyEvent(id, event);
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        dispatch(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
      }
    }
    dispatch(buffer);
    if (!finished) {
      useTrips.getState().failRun(id, "连接意外中断，请重试");
    }
  } catch (error) {
    if (controller.signal.aborted) {
      useTrips.getState().cancelRun(id);
    } else {
      useTrips
        .getState()
        .failRun(id, error instanceof Error ? error.message : "网络异常，请稍后重试");
    }
  } finally {
    running.delete(id);
  }
}

export function cancelAgent(id: string): void {
  running.get(id)?.abort();
}
