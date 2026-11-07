/**
 * 行程本地存储：Zustand + localStorage 持久化。
 * 每份行程保存需求、当前版本、历史版本（用于撤销 AI 调整）以及 Agent 的规划轨迹（可解释性）。
 */
"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import type { AgentEvent, Day, Place, Trip, TripRequest } from "@/lib/schema";

export type TraceItem =
  | { kind: "status"; text: string }
  | { kind: "thought"; text: string }
  | {
      kind: "tool";
      id: string;
      name: string;
      label: string;
      state: "running" | "ok" | "fail";
      summary: string;
    };

export type RunState = "idle" | "planning" | "revising" | "error";

export interface TripRecord {
  id: string;
  createdAt: string;
  request: TripRequest;
  trip: Trip | null;
  /** 运行中逐日到达的草稿天 */
  liveDays: Day[];
  /** 运行中工具发现的地点，用于地图实时落点 */
  livePlaces: Place[];
  trace: TraceItem[];
  run: RunState;
  error: string | null;
  versions: { trip: Trip; label: string; at: string }[];
}

interface TripStore {
  records: Record<string, TripRecord>;
  order: string[];
  create: (request: TripRequest) => string;
  remove: (id: string) => void;
  beginRun: (id: string, mode: "plan" | "revise", instruction?: string) => void;
  applyEvent: (id: string, event: AgentEvent) => void;
  failRun: (id: string, message: string) => void;
  cancelRun: (id: string) => void;
  undo: (id: string) => void;
}

const MAX_RECORDS = 12;
const MAX_VERSIONS = 6;

function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

function update(
  state: TripStore,
  id: string,
  patch: (record: TripRecord) => Partial<TripRecord>,
): Partial<TripStore> {
  const record = state.records[id];
  if (!record) {
    return {};
  }
  return { records: { ...state.records, [id]: { ...record, ...patch(record) } } };
}

/** 连续的思考片段合并成一段，避免轨迹列表碎片化 */
function appendThought(trace: TraceItem[], delta: string): TraceItem[] {
  const last = trace[trace.length - 1];
  if (last?.kind === "thought") {
    return [...trace.slice(0, -1), { kind: "thought", text: last.text + delta }];
  }
  if (!delta.trim()) {
    return trace;
  }
  return [...trace, { kind: "thought", text: delta }];
}

export const useTrips = create<TripStore>()(
  persist(
    (set) => ({
      records: {},
      order: [],
      create: (request) => {
        const id = newId();
        set((state) => {
          const order = [id, ...state.order].slice(0, MAX_RECORDS);
          const records: Record<string, TripRecord> = {};
          for (const key of order) {
            records[key] = state.records[key];
          }
          records[id] = {
            id,
            createdAt: new Date().toISOString(),
            request,
            trip: null,
            liveDays: [],
            livePlaces: [],
            trace: [],
            run: "idle",
            error: null,
            versions: [],
          };
          return { order, records };
        });
        return id;
      },
      remove: (id) =>
        set((state) => {
          const records = { ...state.records };
          delete records[id];
          return { records, order: state.order.filter((key) => key !== id) };
        }),
      beginRun: (id, mode, instruction) =>
        set((state) =>
          update(state, id, (record) => ({
            run: mode === "plan" ? "planning" : "revising",
            error: null,
            liveDays: mode === "plan" ? [] : (record.trip?.days ?? []),
            livePlaces: [],
            trace:
              mode === "plan"
                ? []
                : [
                    ...record.trace,
                    { kind: "status", text: `调整要求：${instruction ?? ""}` },
                  ],
          })),
        ),
      applyEvent: (id, event) =>
        set((state) =>
          update(state, id, (record) => {
            switch (event.type) {
              case "status":
                return {
                  trace: [...record.trace, { kind: "status", text: event.message }],
                };
              case "thought":
                return { trace: appendThought(record.trace, event.delta) };
              case "tool_call":
                return {
                  trace: [
                    ...record.trace,
                    {
                      kind: "tool",
                      id: event.id,
                      name: event.name,
                      label: event.label,
                      state: "running",
                      summary: "",
                    },
                  ],
                };
              case "tool_result":
                return {
                  trace: record.trace.map((item) =>
                    item.kind === "tool" && item.id === event.id
                      ? {
                          ...item,
                          state: event.ok ? "ok" : "fail",
                          summary: event.summary,
                        }
                      : item,
                  ),
                  livePlaces: event.places
                    ? [...record.livePlaces, ...event.places].slice(-80)
                    : record.livePlaces,
                };
              case "day": {
                const others = record.liveDays.filter((day) => day.day !== event.day.day);
                return {
                  liveDays: [...others, event.day].sort((a, b) => a.day - b.day),
                };
              }
              case "trip": {
                const versions = record.trip
                  ? [
                      {
                        trip: record.trip,
                        label: record.trip.changeSummary ?? "初始版本",
                        at: new Date().toISOString(),
                      },
                      ...record.versions,
                    ].slice(0, MAX_VERSIONS)
                  : record.versions;
                return {
                  trip: event.trip,
                  versions,
                  liveDays: [],
                  livePlaces: [],
                  run: "idle",
                };
              }
              case "error":
                return {
                  run: "error",
                  error: event.message,
                  liveDays: [],
                  livePlaces: [],
                };
              default:
                return {};
            }
          }),
        ),
      failRun: (id, message) =>
        set((state) =>
          update(state, id, () => ({ run: "error", error: message, liveDays: [] })),
        ),
      cancelRun: (id) =>
        set((state) =>
          update(state, id, (record) => ({
            run: record.trip ? "idle" : "error",
            error: record.trip ? null : "已取消规划",
            liveDays: [],
            livePlaces: [],
          })),
        ),
      undo: (id) =>
        set((state) =>
          update(state, id, (record) => {
            const [previous, ...rest] = record.versions;
            if (!previous) {
              return {};
            }
            return { trip: previous.trip, versions: rest };
          }),
        ),
    }),
    {
      name: "xingjian-trips",
      version: 1,
      storage: createJSONStorage(() => localStorage),
      // 运行中的临时状态不持久化：刷新后视为中断
      partialize: (state) => ({
        order: state.order,
        records: Object.fromEntries(
          Object.entries(state.records).map(([key, record]) => [
            key,
            {
              ...record,
              liveDays: [],
              livePlaces: [],
              run:
                record.run === "planning" || record.run === "revising"
                  ? "error"
                  : record.run,
              error:
                record.run === "planning" || record.run === "revising"
                  ? "上次规划被中断，可重新生成"
                  : record.error,
            },
          ]),
        ),
      }),
    },
  ),
);
