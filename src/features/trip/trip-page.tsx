"use client";

import { Check, Copy, Map as MapIcon, Printer, RotateCcw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { SiteHeader } from "@/components/site-header";
import { AgentTrace } from "@/features/agent/agent-trace";
import { cancelAgent, isRunning, startAgent } from "@/features/agent/agent-client";
import { MapOverlay } from "@/features/map/map-overlay";
import { TripMap } from "@/features/map/trip-map";
import { tripToMarkdown } from "@/lib/format";
import type { Citation } from "@/lib/schema";
import { formatDateLabel, addDays } from "@/lib/time";
import { useHydrated } from "@/lib/use-hydrated";
import { useTrips, type TripRecord } from "@/store/trips";
import { DayChapter } from "./day-chapter";
import { ReviseDock } from "./revise-dock";
import { TripCover } from "./trip-cover";
import { SwapDialog } from "./swap-dialog";
import { TripOverview } from "./trip-overview";
import { useTripEditor } from "./use-trip-editor";

export function TripPage({ id }: { id: string }) {
  const hydrated = useHydrated();
  const record = useTrips((state) => state.records[id]);

  // 新建的行程进入页面后自动启动规划（模块级去重，避免严格模式重复请求）
  useEffect(() => {
    if (hydrated && record && record.run === "idle" && !record.trip && !isRunning(id)) {
      void startAgent(id, { mode: "plan", request: record.request });
    }
  }, [hydrated, record, id]);

  if (!hydrated) {
    return <SiteHeader />;
  }
  if (!record) {
    return (
      <>
        <SiteHeader />
        <main id="main" className="mx-auto max-w-xl px-5 py-24 text-center">
          <h1 className="font-display text-3xl">找不到这份行程</h1>
          <p className="mt-3 text-ink-soft">
            行程保存在当前浏览器中，可能已被清除或来自其他设备。
          </p>
          <Link
            href="/"
            className="mt-8 inline-flex h-11 items-center rounded-lg bg-pine px-5 text-white"
          >
            重新规划
          </Link>
        </main>
      </>
    );
  }
  if (!record.trip || record.run === "planning") {
    return <PlanningView record={record} />;
  }
  return <TripBook record={record} />;
}

function PlanningView({ record }: { record: TripRecord }) {
  const [startedAt] = useState(() => Date.now());
  const [activeId, setActiveId] = useState<string | null>(null);
  const { request } = record;
  const failed = record.run === "error";
  const pendingDays = Array.from({ length: request.days }, (_, i) => i + 1).filter(
    (day) => !record.liveDays.some((item) => item.day === day),
  );

  return (
    <>
      <SiteHeader />
      <main
        id="main"
        className="mx-auto grid max-w-7xl gap-8 px-5 pb-16 sm:px-8 lg:grid-cols-[380px_minmax(0,1fr)]"
      >
        <aside className="h-[44vh] rounded-2xl border border-line bg-card p-4 lg:sticky lg:top-4 lg:h-[calc(100dvh-6rem)]">
          <AgentTrace trace={record.trace} live={!failed} startedAt={startedAt} />
        </aside>

        <div className="min-w-0">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <p className="text-sm text-ink-soft">
                {formatDateLabel(request.startDate)} 出发 · {request.days} 天 ·{" "}
                {request.travelers} 人
              </p>
              <h1 className="mt-1 font-display text-3xl text-ink sm:text-4xl">
                {failed ? "规划没有完成" : `正在为你规划${request.city}`}
              </h1>
            </div>
            {failed ? null : (
              <Button
                variant="secondary"
                size="sm"
                onClick={() => cancelAgent(record.id)}
              >
                <X size={15} aria-hidden />
                取消
              </Button>
            )}
          </div>

          {failed ? (
            <div
              role="alert"
              className="mt-6 rounded-xl border border-danger/30 bg-card p-5"
            >
              <p className="text-ink">{record.error}</p>
              <div className="mt-4 flex gap-2">
                <Button
                  onClick={() => void startAgent(record.id, { mode: "plan", request })}
                >
                  <RotateCcw size={16} aria-hidden />
                  重新生成
                </Button>
                <Link
                  href="/"
                  className="inline-flex h-11 items-center rounded-lg px-4 text-ink-soft hover:bg-paper-deep"
                >
                  修改需求
                </Link>
              </div>
            </div>
          ) : null}

          <TripMap
            days={record.liveDays}
            candidates={record.livePlaces}
            activeId={activeId}
            onSelect={setActiveId}
            className="mt-6 h-[300px] sm:h-[380px]"
          />
          <p className="mt-2 text-xs text-ink-faint">
            灰点是 Agent 搜到的候选地点，编号点是已经排进行程的站点。
          </p>

          {record.liveDays.map((day) => (
            <DayChapter
              key={day.day}
              day={day}
              citations={new Map()}
              activeId={activeId}
              onFocus={setActiveId}
              pending
            />
          ))}
          {!failed
            ? pendingDays.map((day) => (
                <div
                  key={day}
                  className="mt-10 rounded-xl border border-dashed border-line px-5 py-8"
                >
                  <p className="font-display text-xl text-ink-faint">第 {day} 天</p>
                  <p className="mt-1 text-sm text-ink-faint">
                    {formatDateLabel(addDays(request.startDate, day - 1))} · 等待 Agent
                    编排
                  </p>
                  <div className="mt-4 space-y-2" aria-hidden>
                    <div className="h-3 w-2/3 animate-pulse rounded bg-paper-deep" />
                    <div className="h-3 w-1/2 animate-pulse rounded bg-paper-deep" />
                  </div>
                </div>
              ))
            : null}
        </div>
      </main>
    </>
  );
}

function TripBook({ record }: { record: TripRecord }) {
  const trip = record.trip!;
  const { request } = record;
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeDay, setActiveDay] = useState(1);
  const [copied, setCopied] = useState(false);
  const [mapDay, setMapDay] = useState<number | null>(null);
  const [swapTarget, setSwapTarget] = useState<{ day: number; index: number } | null>(
    null,
  );
  const editor = useTripEditor(record);
  const swapStop = swapTarget
    ? (trip.days.find((day) => day.day === swapTarget.day)?.stops[swapTarget.index] ??
      null)
    : null;
  const citations = useMemo(
    () => new Map<string, Citation>(trip.citations.map((c) => [c.id, c])),
    [trip],
  );
  const observer = useRef<IntersectionObserver | null>(null);

  // 滚动联动：当前阅读到哪一天，地图就显示哪一天
  useEffect(() => {
    observer.current?.disconnect();
    observer.current = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((entry) => entry.isIntersecting);
        if (visible.length) {
          const day = Number((visible[0].target as HTMLElement).dataset.day);
          if (day) {
            setActiveDay(day);
          }
        }
      },
      { rootMargin: "-30% 0px -60% 0px" },
    );
    document
      .querySelectorAll("[data-day]")
      .forEach((node) => observer.current?.observe(node));
    return () => observer.current?.disconnect();
  }, [trip]);

  const focusStop = useCallback((id: string) => {
    const day = Number(id.split("-")[0]);
    if (!day) {
      return;
    }
    setActiveId(id);
    setActiveDay(day);
    document
      .getElementById(`stop-${id}`)
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  const copy = async () => {
    await navigator.clipboard.writeText(tripToMarkdown(trip, request));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  return (
    <>
      <SiteHeader>
        <button
          type="button"
          onClick={copy}
          className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-ink-soft hover:bg-paper-deep hover:text-ink sm:flex"
        >
          {copied ? <Check size={15} aria-hidden /> : <Copy size={15} aria-hidden />}
          {copied ? "已复制" : "复制文本"}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="hidden items-center gap-1.5 rounded-md px-3 py-2 text-ink-soft hover:bg-paper-deep hover:text-ink sm:flex"
        >
          <Printer size={15} aria-hidden />
          打印 / PDF
        </button>
      </SiteHeader>

      <main id="main" className="mx-auto max-w-7xl px-4 pb-48 sm:px-8">
        {record.sample ? (
          <p className="no-print mb-4 rounded-lg border border-line bg-card px-4 py-2.5 text-sm text-ink-soft">
            这是一份示例手册，由行间 Agent 于{" "}
            {new Date(trip.generatedAt).toLocaleDateString("zh-CN")}{" "}
            实际生成，日期、天气和营业信息可能已经变化。可以直接在下方对它提出调整，或回到首页规划自己的旅行。
          </p>
        ) : null}
        {editor.error ? (
          <p
            role="alert"
            className="no-print mb-4 rounded-lg border border-danger/30 bg-card px-4 py-2.5 text-sm text-danger"
          >
            {editor.error}
          </p>
        ) : null}
        <TripCover trip={trip} request={request} />

        <nav
          aria-label="章节"
          className="no-print sticky top-0 z-20 -mx-4 mt-6 flex gap-1 overflow-x-auto border-b border-line bg-paper/95 px-4 py-2 backdrop-blur sm:-mx-8 sm:px-8"
        >
          <a
            href="#overview"
            className="shrink-0 rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-deep hover:text-ink"
          >
            总览
          </a>
          {trip.days.map((day) => (
            <a
              key={day.day}
              href={`#day-${day.day}`}
              aria-current={activeDay === day.day ? "true" : undefined}
              className={`shrink-0 rounded-md px-3 py-1.5 text-sm transition-colors ${
                activeDay === day.day
                  ? "bg-ink text-paper"
                  : "text-ink-soft hover:bg-paper-deep hover:text-ink"
              }`}
            >
              第 {day.day} 天 · {day.theme}
            </a>
          ))}
          <a
            href="#tips"
            className="shrink-0 rounded-md px-3 py-1.5 text-sm text-ink-soft hover:bg-paper-deep hover:text-ink"
          >
            贴士与来源
          </a>
        </nav>

        <div className="mx-auto mt-8 max-w-[960px]">
          <div className="min-w-0">
            <TripOverview trip={trip} request={request} />
            {trip.days.map((day) => (
              <DayChapter
                key={day.day}
                day={day}
                citations={citations}
                activeId={activeId}
                onFocus={focusStop}
                hotel={trip.hotel}
                editor={editor}
                onSwap={(day, index) => setSwapTarget({ day, index })}
                onExpandMap={setMapDay}
              />
            ))}
            <SwapDialog
              stop={swapStop}
              candidates={trip.candidates}
              onClose={() => setSwapTarget(null)}
              onPick={(place) => {
                if (swapTarget) {
                  editor.replace(swapTarget.day, swapTarget.index, place);
                }
                setSwapTarget(null);
              }}
            />

            <section id="tips" className="scroll-mt-24 pt-16">
              <h2 className="border-b border-ink pb-4 font-display text-[28px] text-ink">
                贴士与准备
              </h2>
              <div className="mt-6 grid gap-8 md:grid-cols-[1.4fr_1fr]">
                <ol className="space-y-3">
                  {trip.tips.map((tip, index) => (
                    <li
                      key={index}
                      className="flex gap-3 text-[15px] leading-relaxed text-ink"
                    >
                      <span className="font-display text-pine tabular">{index + 1}.</span>
                      <span>
                        {tip.text}
                        {tip.citations.map((cid) =>
                          citations.has(cid) ? (
                            <a
                              key={cid}
                              href={`#cite-${cid}`}
                              className="ml-1 text-xs text-pine hover:underline"
                            >
                              [{citations.get(cid)!.title}]
                            </a>
                          ) : null,
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
                {trip.packing.length ? (
                  <div>
                    <h3 className="text-sm font-medium text-ink">行李清单</h3>
                    <ul className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
                      {trip.packing.map((item) => (
                        <li
                          key={item}
                          className="flex items-center gap-2 text-sm text-ink-soft"
                        >
                          <span
                            className="size-3.5 rounded-sm border border-ink-faint"
                            aria-hidden
                          />
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <h3 className="mt-14 font-display text-xl text-ink">信息来源</h3>
              <p className="mt-2 text-sm text-ink-soft">
                手册中的地点、评分、营业时间、实景图、路线与天气均来自高德开放平台的实时查询；玩法与注意事项引用自行间旅行知识库；门票、餐费与住宿为
                AI 估算。生成于{" "}
                {new Date(trip.generatedAt).toLocaleString("zh-CN", { hour12: false })}
                ，出行前请以景区官方公告为准。
              </p>
              {trip.citations.length ? (
                <ol className="mt-5 space-y-3">
                  {trip.citations.map((citation) => (
                    <li
                      key={citation.id}
                      id={`cite-${citation.id}`}
                      className="scroll-mt-24 rounded-lg border border-line-soft bg-card px-4 py-3 target:border-pine"
                    >
                      <p className="text-sm font-medium text-ink">
                        {citation.title}
                        <span className="ml-2 text-xs font-normal text-ink-faint">
                          {citation.source}
                        </span>
                      </p>
                      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                        {citation.excerpt}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : null}

              <details className="no-print mt-10 rounded-xl border border-line bg-card p-4">
                <summary className="cursor-pointer text-sm font-medium text-ink">
                  查看 AI 的完整规划过程
                </summary>
                <div className="mt-4">
                  <AgentTrace trace={record.trace} live={false} compact />
                </div>
              </details>

              <div className="no-print mt-10 flex flex-wrap gap-3">
                <Link
                  href="/"
                  className="inline-flex h-11 items-center rounded-lg border border-line bg-card px-4 text-ink-soft hover:text-ink"
                >
                  规划新的旅行
                </Link>
                <Button
                  variant="ghost"
                  onClick={() => void startAgent(record.id, { mode: "plan", request })}
                >
                  <RotateCcw size={16} aria-hidden />
                  按原需求重新生成
                </Button>
              </div>
            </section>
          </div>
        </div>
      </main>
      <button
        type="button"
        onClick={() => setMapDay(activeDay)}
        className="no-print fixed bottom-[132px] right-4 z-30 flex h-12 items-center gap-2 rounded-full bg-ink px-4 text-sm font-medium text-paper shadow-float transition-colors hover:bg-pine-deep sm:bottom-8 sm:right-8"
        aria-label={`打开第 ${activeDay} 天全屏地图`}
      >
        <MapIcon size={18} aria-hidden />
        地图
      </button>
      <MapOverlay
        days={trip.days}
        hotel={trip.hotel}
        day={mapDay}
        onDayChange={setMapDay}
        onClose={() => setMapDay(null)}
        onLocate={(id) => {
          setMapDay(null);
          requestAnimationFrame(() => focusStop(id));
        }}
      />
      <ReviseDock record={record} />
    </>
  );
}
