"use client";

import {
  BookCheck,
  BookOpenText,
  CalendarCheck,
  Check,
  CloudSun,
  Loader2,
  MapPin,
  Utensils,
  Waypoints,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TraceItem } from "@/store/trips";

const ICONS: Record<string, LucideIcon> = {
  search_knowledge: BookOpenText,
  search_places: MapPin,
  search_nearby: Utensils,
  get_weather: CloudSun,
  arrange_places: Waypoints,
  save_day_plan: CalendarCheck,
  finalize_trip: BookCheck,
};

const KIND_LABEL: Record<string, string> = {
  search_knowledge: "知识库 RAG",
  search_places: "高德地点",
  search_nearby: "高德周边",
  get_weather: "高德天气",
  arrange_places: "空间算法",
  save_day_plan: "排程校验",
  finalize_trip: "汇总",
};

function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(since);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const seconds = Math.max(0, Math.floor((now - since) / 1000));
  return (
    <span className="tabular">
      {String(Math.floor(seconds / 60)).padStart(2, "0")}:
      {String(seconds % 60).padStart(2, "0")}
    </span>
  );
}

export function AgentTrace({
  trace,
  live,
  startedAt,
  compact = false,
}: {
  trace: TraceItem[];
  live: boolean;
  startedAt?: number;
  compact?: boolean;
}) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) {
      end.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [trace.length, live]);

  const tools = trace.filter((item) => item.kind === "tool");
  const done = tools.filter(
    (item) => item.kind === "tool" && item.state !== "running",
  ).length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft pb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          {live ? (
            <span className="relative flex size-2.5">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-pine/50" />
              <span className="relative inline-flex size-2.5 rounded-full bg-pine" />
            </span>
          ) : null}
          {live ? "Agent 正在规划" : "AI 规划过程"}
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-faint">
          <span className="tabular">{done} 次工具调用</span>
          {live && startedAt ? <Elapsed since={startedAt} /> : null}
        </div>
      </div>
      <ol
        className={`mt-3 space-y-2.5 ${compact ? "" : "min-h-0 flex-1 overflow-y-auto pr-1"}`}
        aria-live="polite"
      >
        {trace.map((item, index) => {
          if (item.kind === "status") {
            return (
              <li key={index} className="text-xs text-ink-faint">
                {item.text}
              </li>
            );
          }
          if (item.kind === "thought") {
            const last = index === trace.length - 1 && live;
            return (
              <li
                key={index}
                className="animate-rise border-l-2 border-line pl-3 text-sm leading-relaxed text-ink-soft"
              >
                {item.text.trim()}
                {last ? (
                  <span className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse-dot bg-pine align-middle" />
                ) : null}
              </li>
            );
          }
          const Icon = ICONS[item.name] ?? Waypoints;
          return (
            <li
              key={item.id}
              className={`animate-rise rounded-lg border px-3 py-2.5 ${
                item.state === "fail"
                  ? "border-amber/40 bg-amber-soft/50"
                  : "border-line-soft bg-card"
              }`}
            >
              <div className="flex items-start gap-2.5">
                <Icon size={16} className="mt-0.5 shrink-0 text-pine" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink">
                      {item.label}
                    </span>
                    <span
                      className="shrink-0"
                      aria-label={
                        item.state === "running"
                          ? "进行中"
                          : item.state === "ok"
                            ? "成功"
                            : "需修正"
                      }
                    >
                      {item.state === "running" ? (
                        <Loader2 size={15} className="animate-spin text-ink-faint" />
                      ) : item.state === "ok" ? (
                        <Check size={15} className="text-pine" />
                      ) : (
                        <X size={15} className="text-amber" />
                      )}
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2 text-xs text-ink-faint">
                    <span className="rounded bg-paper-deep px-1.5 py-px text-[11px] text-ink-soft">
                      {KIND_LABEL[item.name] ?? "工具"}
                    </span>
                    {item.summary ? (
                      <span className="text-ink-soft">{item.summary}</span>
                    ) : null}
                  </div>
                </div>
              </div>
            </li>
          );
        })}
        <div ref={end} />
      </ol>
    </div>
  );
}
