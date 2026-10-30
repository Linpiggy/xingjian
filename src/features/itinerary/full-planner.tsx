"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/arc/button/button";
import { useConfirmDialog } from "@/components/arc/dialog/confirm-dialog";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TripSiteHeader } from "./trip-site-header";
import { Compass, Check, RotateCcw, ArrowUpRight } from "lucide-react";
import type { TripBrief } from "@/domain/trip-brief";
import { BriefForm } from "./brief-form";
import type { GenerationProgress } from "./planning-progress";
import { ItineraryBook } from "./itinerary-book";
import { requestItinerary, PlanningRequestError } from "./request-itinerary";
import { useItineraryStore } from "./itinerary-store";
import "./itinerary.css";
import { ItineraryChangePreview } from "./itinerary-change-preview";
import { prepareItineraryMove } from "@/domain/itinerary-moves";
import { ItineraryRouteReview } from "./itinerary-route-review";
import { ItineraryExpenseComparison } from "./itinerary-expense-view";

export function FullPlanner({
  startDate,
  mapKey,
  mapsConfigured,
  view = "auto",
  embedded = false,
  active = true,
}: {
  startDate: string;
  mapKey: string;
  mapsConfigured: boolean;
  view?: "auto" | "new" | "itinerary";
  embedded?: boolean;
  active?: boolean;
}) {
  const router = useRouter();
  const { confirm: askConfirmation, confirmation } = useConfirmDialog();
  const returnTarget = useRef<HTMLElement | null>(null);
  const focusedReview = useRef<number | null>(null);
  const [reviewHost, setReviewHost] = useState<HTMLDivElement | null>(null);
  const { plan, review, previous, history, version } = useItineraryStore();
  const [editing, setEditing] = useState(
    () =>
      view === "new" || (view === "auto" && useItineraryStore.getState().plan === null),
  );
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState("");
  const [generation, setGeneration] = useState<GenerationProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [failure, setFailure] = useState<PlanningRequestError | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const dirty = useRef(false);
  useEffect(() => {
    if (cooldown <= 0) {
      return;
    }
    const timer = setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  const mutation = useMutation({
    mutationFn: ({ brief, signal }: { brief: TripBrief; signal: AbortSignal }) =>
      requestItinerary(brief, signal, (message, stage, work) => {
        if (!signal.aborted) {
          setProgress(message);
          setGeneration((previous) => ({
            stage: stage ?? previous?.stage ?? "places",
            work: work ?? (stage === previous?.stage ? (previous?.work ?? null) : null),
            startedAt: previous?.startedAt ?? Date.now(),
          }));
        }
      }),
    gcTime: 0,
    retry: false,
  });
  useEffect(() => () => controller.current?.abort(), []);
  const reviewId = review?.id;
  useEffect(() => {
    if (
      !editing &&
      reviewId !== undefined &&
      reviewHost &&
      focusedReview.current !== reviewId
    ) {
      const heading = document.getElementById("trip-review-heading");
      if (heading) {
        focusedReview.current = reviewId;
        heading.focus({ preventScroll: true });
        document
          .getElementById("trip-confirm-change")
          ?.scrollIntoView({ block: "nearest", behavior: "instant" });
      }
    }
  }, [editing, reviewId, reviewHost]);
  async function generate(brief: TripBrief) {
    if (controller.current || cooldown > 0) {
      return;
    }
    if (useItineraryStore.getState().review) {
      setError(
        "当前仍有尚未确认的预览，请先返回当前方案确认或放弃，再生成；本次未发起请求。",
      );
      return;
    }
    const request = new AbortController();
    controller.current = request;
    const baseVersion = useItineraryStore.getState().version;
    setPending(true);
    setGeneration({ stage: "places", work: null, startedAt: Date.now() });
    setError(null);
    setFailure(null);
    setProgress("正在准备公开候选与完整旅行方案…");
    try {
      const result = await mutation.mutateAsync({ brief, signal: request.signal });
      if (request.signal.aborted || controller.current !== request) {
        return;
      }
      useItineraryStore.getState().receive(result, baseVersion);
      dirty.current = false;
      setEditing(false);
      setProgress("");
      requestAnimationFrame(() => {
        if (!useItineraryStore.getState().review) {
          document.getElementById("itinerary-heading")?.focus({ preventScroll: true });
          document
            .getElementById("itinerary-heading")
            ?.scrollIntoView({ block: "start", behavior: "instant" });
        }
      });
      if (view === "new" && !embedded) {
        router.push("/itinerary");
      }
    } catch (cause) {
      if (!request.signal.aborted) {
        setProgress("");
        setError(cause instanceof Error ? cause.message : "方案生成失败，请重试。");
        if (cause instanceof PlanningRequestError) {
          setFailure(cause);
          setCooldown(cause.retryAfterSeconds ?? 0);
        }
      }
    } finally {
      if (controller.current === request) {
        controller.current = null;
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
  async function edit() {
    if (
      review &&
      !(await askConfirmation("放弃这份尚未确认的新方案，返回填写需求吗？"))
    ) {
      return;
    }
    useItineraryStore.getState().cancelReview();
    dirty.current = false;
    setEditing(true);
    setError(null);
    if (view === "itinerary") {
      router.push("/plan");
    }
  }
  function confirm() {
    try {
      useItineraryStore.getState().confirm();
      setError(null);
      requestAnimationFrame(
        () =>
          returnTarget.current?.isConnected &&
          returnTarget.current.focus({ preventScroll: true }),
      );
    } catch (cause) {
      if (!review?.change) {
        useItineraryStore.getState().cancelReview();
        setEditing(true);
      }
      setError(cause instanceof Error ? cause.message : "方案未应用。");
    }
  }
  const visible = review?.plan ?? plan;
  const Content = embedded ? "section" : "main";
  return (
    <div
      className={embedded ? "itinerary-embedded" : "trip-app"}
      data-plan-revision={version}
    >
      {confirmation}
      {!embedded && (
        <>
          <TripSiteHeader
            beforeNavigate={() =>
              !editing ||
              !dirty.current ||
              askConfirmation(
                "离开会丢弃本页尚未提交的需求，当前已生成方案不会删除。继续吗？",
              )
            }
          />
        </>
      )}
      <Content
        id={embedded ? "trip-main" : "main"}
        tabIndex={embedded ? undefined : -1}
        className={editing ? "trip-entry" : "trip-result"}
        onInputCapture={() => {
          if (editing) {
            dirty.current = true;
          }
        }}
        onClickCapture={(event) => {
          if (
            editing &&
            event.target instanceof Element &&
            event.target.closest(".trip-purpose-grid button")
          ) {
            dirty.current = true;
          }
        }}
      >
        {editing ? (
          <>
            <div className="trip-entry-heading">
              <h1>规划旅行</h1>
            </div>
            <div className="trip-entry-grid">
              <BriefForm
                key={plan?.generatedAt ?? "new"}
                startDate={startDate}
                initial={plan?.brief ?? null}
                pending={pending}
                progress={progress}
                generation={generation}
                error={error}
                failure={failure}
                cooldown={cooldown}
                onSubmit={generate}
                onDraftChange={() => {
                  dirty.current = true;
                }}
                onCancel={cancel}
                onBackToPlan={
                  plan
                    ? () => {
                        if (pending) {
                          cancel();
                        }
                        setEditing(false);
                        if (view === "new" && !embedded) {
                          router.push("/itinerary");
                        }
                      }
                    : undefined
                }
              />
            </div>
            {!pending && progress && (
              <p className="trip-operation-status" role="status">
                {progress}
              </p>
            )}
          </>
        ) : visible ? (
          <>
            {review &&
              reviewHost &&
              createPortal(
                <section className="trip-review-bar" aria-label="新方案确认">
                  <p id="trip-review-heading" tabIndex={-1}>
                    {review.change
                      ? review.change.kind === "expenses"
                        ? "这是一份费用估算预览，当前方案尚未改变。"
                        : "这是一项活动修改预览，当前方案尚未改变。"
                      : "这是一份新方案预览，当前方案尚未改变。"}
                  </p>
                  <Button
                    className="button"
                    onClick={() => {
                      useItineraryStore.getState().cancelReview();
                      setError(null);
                      requestAnimationFrame(
                        () =>
                          returnTarget.current?.isConnected &&
                          returnTarget.current.focus({ preventScroll: true }),
                      );
                    }}
                  >
                    保留原方案
                  </Button>
                  <Button
                    variant="primary"
                    className="button primary"
                    id="trip-confirm-change"
                    disabled={
                      review.plan.status === "infeasible" ||
                      (review.change?.kind === "move" &&
                        plan !== null &&
                        prepareItineraryMove(plan, review.change, review.routes).missing
                          .length > 0)
                    }
                    onClick={confirm}
                  >
                    <Check size={16} aria-hidden="true" />
                    {review.change ? "确认此项修改" : "确认使用新方案"}
                  </Button>
                  {review.change && plan && (
                    <ItineraryChangePreview
                      before={plan}
                      after={review.plan}
                      change={review.change}
                    />
                  )}
                  {!review.change &&
                    plan &&
                    JSON.stringify(plan.expenses) !==
                      JSON.stringify(review.plan.expenses) &&
                    (Object.values(plan.expenses?.items ?? {}).some(
                      (entry) => entry.amountFen !== null,
                    ) ||
                      Object.values(review.plan.expenses?.items ?? {}).some(
                        (entry) => entry.amountFen !== null,
                      )) && (
                      <ItineraryExpenseComparison before={plan} after={review.plan} />
                    )}
                  {review.change?.kind === "move" && plan && (
                    <ItineraryRouteReview
                      key={review.id}
                      before={plan}
                      change={review.change}
                      routes={review.routes}
                      proposalId={review.id}
                      baseVersion={review.baseVersion}
                      conflicted={review.plan.status === "infeasible"}
                    />
                  )}
                  {error && (
                    <p role="alert" className="trip-error">
                      {error}
                    </p>
                  )}
                  {review.plan.status === "infeasible" && (
                    <p className="trip-conflict">
                      请先解决行程冲突后再确认，当前方案保持不变。
                    </p>
                  )}
                </section>,
                reviewHost,
              )}
            {previous && !review && (
              <Button
                className="button trip-undo"
                onClick={() => {
                  useItineraryStore.getState().undo();
                  requestAnimationFrame(
                    () =>
                      returnTarget.current?.isConnected &&
                      returnTarget.current.focus({ preventScroll: true }),
                  );
                }}
              >
                <RotateCcw size={16} aria-hidden="true" />
                <span>
                  撤销上次修改
                  <small className="trip-undo-context">
                    {history.at(-1)?.label ?? "方案调整"} · 还可撤销 {history.length || 1}{" "}
                    步
                  </small>
                </span>
              </Button>
            )}
            <ItineraryBook
              plan={visible}
              mapKey={mapKey}
              mapsConfigured={mapsConfigured}
              active={active}
              onEdit={edit}
              onReviewHost={review ? setReviewHost : undefined}
              reviewActivityId={
                review?.change && review.change.kind !== "expenses"
                  ? review.change.activityId
                  : undefined
              }
              reviewExpenses={review?.change?.kind === "expenses"}
              reviewAtCover={Boolean(review && !review.change)}
              onActivityChange={
                review
                  ? undefined
                  : (change) => {
                      returnTarget.current = document.getElementById(
                        change.kind === "expenses"
                          ? "itinerary-expenses-trigger"
                          : `edit-activity-${change.activityId}`,
                      );
                      useItineraryStore.getState().proposeChange(change);
                      setError(null);
                    }
              }
            />
          </>
        ) : (
          <section
            className="trip-empty-itinerary"
            aria-labelledby="empty-itinerary-heading"
          >
            <Compass size={48} strokeWidth={1.2} aria-hidden="true" />
            <p>你的旅行提案</p>
            <h1 id="empty-itinerary-heading">还没有当前行程</h1>
            <p>
              从一个目的地开始，安排每天的游览、三餐和地点间步行。已有方案仅在当前页面会话内保留，刷新会清空。
            </p>
            <Link href="/plan" className="button primary">
              新建旅行规划 <ArrowUpRight size={16} aria-hidden="true" />
            </Link>
          </section>
        )}
      </Content>
    </div>
  );
}
