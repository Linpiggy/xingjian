"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import Link from "next/link";
import { Compass, Check, RotateCcw } from "lucide-react";
import type { TripBrief } from "@/domain/trip-brief";
import { BriefForm } from "./brief-form";
import { ItineraryBook } from "./itinerary-book";
import { requestItinerary } from "./request-itinerary";
import { useItineraryStore } from "./itinerary-store";
import "./itinerary.css";

export function FullPlanner({
  startDate,
  mapKey,
  mapsConfigured,
}: {
  startDate: string;
  mapKey: string;
  mapsConfigured: boolean;
}) {
  const { plan, review, previous, version } = useItineraryStore();
  const [editing, setEditing] = useState(
    () => useItineraryStore.getState().plan === null,
  );
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const mutation = useMutation({
    mutationFn: ({ brief, signal }: { brief: TripBrief; signal: AbortSignal }) =>
      requestItinerary(brief, signal, (message) => {
        if (!signal.aborted) {
          setProgress(message);
        }
      }),
    gcTime: 0,
    retry: false,
  });
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    if (!editing) {
      document.getElementById("itinerary-heading")?.focus();
    }
  }, [editing, plan, review]);
  async function generate(brief: TripBrief) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    const baseVersion = useItineraryStore.getState().version;
    setPending(true);
    setError(null);
    setProgress("正在准备公开候选与完整旅行方案…");
    try {
      const result = await mutation.mutateAsync({ brief, signal: request.signal });
      if (request.signal.aborted || controller.current !== request) {
        return;
      }
      useItineraryStore.getState().receive(result, baseVersion);
      setEditing(false);
      setProgress("");
    } catch (cause) {
      if (!request.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "方案生成失败，请重试。");
      }
    } finally {
      if (controller.current === request) {
        setPending(false);
        mutation.reset();
      }
    }
  }
  function cancel() {
    controller.current?.abort();
    controller.current = null;
    setPending(false);
    setProgress("已取消生成，原方案保持不变。");
    mutation.reset();
  }
  function edit() {
    if (review && !window.confirm("放弃这份尚未确认的新方案，返回填写需求吗？")) {
      return;
    }
    useItineraryStore.getState().cancelReview();
    setEditing(true);
    setError(null);
  }
  function confirm() {
    try {
      useItineraryStore.getState().confirm();
    } catch (cause) {
      useItineraryStore.getState().cancelReview();
      setEditing(true);
      setError(cause instanceof Error ? cause.message : "方案未应用。");
    }
  }
  const visible = review?.plan ?? plan;
  return (
    <div className="trip-app" data-plan-revision={version}>
      <a className="skip-link" href="#trip-main">
        跳到主要内容
      </a>
      <header className="trip-site-header">
        <Link href="/" className="trip-brand">
          <Compass size={24} aria-hidden="true" />
          行间
        </Link>
        <span>完整旅行规划</span>
        <Link href="/manual">手动选点</Link>
      </header>
      <main id="trip-main" className={editing ? "trip-entry" : "trip-result"}>
        {editing ? (
          <>
            <div className="trip-entry-heading">
              <span>把想体验的，安排进真实的一天</span>
              <h1>这次，想怎样旅行？</h1>
              <p>
                留下时间、预算与不能错过的，其余交给规划。
                <br />
                不必先选齐景点，也不必亲手排满每一天。
              </p>
            </div>
            <div className="trip-entry-grid">
              <BriefForm
                key={plan?.generatedAt ?? "new"}
                startDate={startDate}
                initial={plan?.brief ?? null}
                pending={pending}
                progress={progress}
                error={error}
                onSubmit={generate}
                onCancel={cancel}
              />
              <aside className="trip-entry-aside">
                <div className="trip-entry-aside-mark">
                  <Compass size={40} strokeWidth={1.2} aria-hidden="true" />
                </div>
                <h2>吃、玩、路程，都有安排。</h2>
                <p>从早晨吃什么，到晚上如何回程；把路上的时间，也算进行程。</p>
                <dl>
                  <div>
                    <dt>完整日程</dt>
                    <dd>活动、三餐与实际相邻路线</dd>
                  </div>
                  <div>
                    <dt>你的优先级</dt>
                    <dd>必去、必吃与主要旅行目的</dd>
                  </div>
                  <div>
                    <dt>留出余地</dt>
                    <dd>真实可用时段与费用目标</dd>
                  </div>
                </dl>
                <p className="trip-aside-note">
                  营业、预约、天气与真实价格仍须核实。预算分配是目标建议，不是报价或达标承诺。
                </p>
                {plan && (
                  <button
                    className="button"
                    onClick={() => {
                      if (pending) {
                        cancel();
                      }
                      setEditing(false);
                    }}
                  >
                    返回当前方案
                  </button>
                )}
              </aside>
            </div>
            {!pending && progress && (
              <p className="trip-operation-status" role="status">
                {progress}
              </p>
            )}
          </>
        ) : visible ? (
          <>
            {review && (
              <section className="trip-review-bar" aria-label="新方案确认">
                <p>这是一份新方案预览，当前方案尚未改变。</p>
                <button
                  className="button"
                  onClick={() => useItineraryStore.getState().cancelReview()}
                >
                  保留原方案
                </button>
                <button className="button primary" onClick={confirm}>
                  <Check size={16} aria-hidden="true" />
                  确认使用新方案
                </button>
              </section>
            )}
            {previous && !review && (
              <button
                className="button trip-undo"
                onClick={() => useItineraryStore.getState().undo()}
              >
                <RotateCcw size={16} aria-hidden="true" />
                撤销方案替换
              </button>
            )}
            <ItineraryBook
              key={`${version}:${Boolean(review)}`}
              plan={visible}
              mapKey={mapKey}
              mapsConfigured={mapsConfigured}
              onEdit={edit}
            />
          </>
        ) : null}
      </main>
    </div>
  );
}
