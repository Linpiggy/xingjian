"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { z } from "zod";
import { formatMinute } from "@/domain/draft";
import { deriveMealTrip, stopIdentity } from "@/domain/meals";
import type { WalkingRoute } from "@/domain/models";
import {
  previewEdit,
  resolveEdit,
  type EditProposal,
  type EditState,
} from "@/domain/editing";
import { walkingSchema } from "@/lib/contracts";
import { requestJson } from "@/lib/client-api";
import { useDraftEditor } from "./editor-store";
import { usePlannerUi } from "./ui-store";
import { IntercityView } from "./intercity-panel";

const routeResponseSchema = z.object({ route: walkingSchema });

function routeDescription(route: WalkingRoute | null | undefined) {
  const seconds = route?.seconds;
  const meters = route?.meters;
  const time = seconds == null ? "耗时待校验" : `${Math.ceil(seconds / 60)} 分钟`;
  const distance = meters == null ? "距离待校验" : `${(meters / 1000).toFixed(1)} km`;
  return `步行：${time} / ${distance}`;
}

export function EditDialog({
  state,
  placeId,
  initialIndex,
  onClose,
}: {
  state: EditState;
  placeId: string;
  initialIndex?: number;
  onClose: () => void;
}) {
  const originDay = state.draft.days.findIndex((day) =>
    day.items.some((item) => item.place.id === placeId),
  );
  const originIndex = state.draft.days[originDay].items.findIndex(
    (item) => item.place.id === placeId,
  );
  const stop = state.draft.days[originDay].items[originIndex];
  const [toDay, setToDay] = useState(originDay);
  const [toIndex, setToIndex] = useState(initialIndex ?? originIndex);
  const [duration, setDuration] = useState(String(stop.stayMinutes));
  const [proposal, setProposal] = useState<EditProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const resolved = useRef<WalkingRoute[]>([]);
  const positions = state.draft.days[toDay].items.length + (toDay === originDay ? 0 : 1);

  useEffect(() => {
    dialog.current?.showModal();
    return () => request.current?.abort();
  }, []);

  function close() {
    request.current?.abort();
    dialog.current?.close();
    onClose();
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const current = useDraftEditor.getState().current;
      if (!current || current.sessionId !== state.sessionId) {
        throw new Error("行程已变化，请关闭窗口后重新预览。");
      }
      setProposal(
        previewEdit(current, {
          placeId,
          toDay,
          toIndex,
          stayMinutes: Number(duration),
        }),
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未能预览修改。");
    }
  }

  async function queryRoutes() {
    if (!proposal || pending) {
      return;
    }
    setPending(true);
    setError(null);
    const controller = new AbortController();
    request.current = controller;
    try {
      const before = useDraftEditor.getState().current;
      if (
        !before ||
        before.sessionId !== proposal.sessionId ||
        before.version !== proposal.baseVersion
      ) {
        throw new Error("行程已变化，请重新预览。");
      }
      for (const gap of proposal.gaps.slice(resolved.current.length)) {
        const result = await requestJson("/api/routes", routeResponseSchema, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin: gap.origin, destination: gap.destination }),
          signal: controller.signal,
        });
        resolved.current.push(result.route);
      }
      if (controller.signal.aborted) {
        return;
      }
      const current = useDraftEditor.getState().current;
      if (!current) {
        throw new Error("当前行程已关闭，未应用修改。");
      }
      setProposal(resolveEdit(current, proposal, resolved.current));
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(cause instanceof Error ? cause.message : "路线查询失败，请重试。");
      }
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
      }
    }
  }

  function confirm() {
    if (!proposal || pending) {
      return;
    }
    try {
      useDraftEditor.getState().confirm(proposal);
      usePlannerUi.getState().changeDay(proposal.operation.toDay);
      close();
      requestAnimationFrame(() => {
        if (useDraftEditor.getState().current?.sessionId === proposal.sessionId) {
          document.getElementById(`edit-stop-${placeId}`)?.focus();
        }
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未应用修改。");
    }
  }

  return (
    <dialog
      ref={dialog}
      className="details-dialog edit-dialog"
      aria-labelledby="edit-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="edit-dialog-title">调整行程</h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭调整行程"
          onClick={close}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="edit-place-name">{stop.place.name}</p>
      {!proposal ? (
        <form onSubmit={preview} noValidate>
          <div className="field-grid">
            <div className="field">
              <label htmlFor="edit-day">安排日期</label>
              <select
                id="edit-day"
                value={toDay}
                onChange={(event) => {
                  const index = Number(event.target.value);
                  setToDay(index);
                  setToIndex(
                    index === originDay
                      ? originIndex
                      : state.draft.days[index].items.length,
                  );
                }}
              >
                {state.draft.days.map((day, index) => (
                  <option key={day.date} value={index}>
                    第 {index + 1} 天 / {day.date}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="edit-position">当天顺序</label>
              <select
                id="edit-position"
                value={toIndex}
                onChange={(event) => setToIndex(Number(event.target.value))}
              >
                {Array.from({ length: positions }, (_, index) => (
                  <option key={index} value={index}>
                    第 {index + 1} 个地点
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="edit-duration">停留时间（分钟）</label>
              <input
                id="edit-duration"
                type="number"
                min={15}
                max={240}
                value={duration}
                onChange={(event) => setDuration(event.target.value)}
              />
              <small>15-240 分钟，采用你的估算。</small>
            </div>
          </div>
          <div className="form-actions">
            <small>预览不会改变当前行程。</small>
            <button className="button primary" type="submit">
              预览修改
            </button>
          </div>
        </form>
      ) : (
        <section aria-label="修改预览">
          <p className="small muted">确认前，当前行程保持不变。</p>
          <div className="edit-comparison">
            {[
              {
                title: "当前安排",
                draft: deriveMealTrip(state.draft, state.locks, state.meals).draft,
              },
              { title: "调整后", draft: proposal.effectiveDraft },
            ].map(({ title, draft }) => (
              <div key={title}>
                <h3>{title}</h3>
                {draft.days.map((day, index) => (
                  <div key={day.date} className="edit-preview-day">
                    <strong>第 {index + 1} 天</strong>
                    <ol>
                      {day.items.map((item, itemIndex) => (
                        <li key={stopIdentity(item)}>
                          <span>{item.place.name}</span>
                          <small>
                            {formatMinute(item.startMinute)} -{" "}
                            {formatMinute(item.endMinute)} / 停留 {item.stayMinutes} 分钟
                          </small>
                          {itemIndex > 0 && (
                            <small>
                              {routeDescription(day.legs[itemIndex - 1]?.route)}
                            </small>
                          )}
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            ))}
          </div>
          <p className="notice">预算目标不变，实际费用仍需核实。</p>
          {state.intercity.segments.length > 0 && (
            <section className="spacing" aria-label="修改后跨城校验">
              <h3>修改后跨城校验</h3>
              <IntercityView draft={proposal.effectiveDraft} setup={state.intercity} />
            </section>
          )}
          {proposal.conflicts.map((conflict) => (
            <p key={conflict} className="notice warning" role="status">
              {conflict}
            </p>
          ))}
          {proposal.effectiveDraft.days.flatMap((day) =>
            [...new Set(day.issues)].map((issue) => (
              <p key={`${day.date}-${issue}`} className="small error-text">
                {day.date}：{issue}
              </p>
            )),
          )}
          {proposal.routes === null && (
            <div className="notice">
              <p>
                需要重新查询 {proposal.gaps.length}{" "}
                段步行路线，可能消耗接口额度。未变动的路段不重新请求。
              </p>
            </div>
          )}
          {pending && (
            <p className="skeleton-lines" role="status">
              正在查询受影响的路线，当前行程保持不变。
            </p>
          )}
          <div className="edit-actions">
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={() => {
                resolved.current = [];
                setProposal(null);
                setError(null);
              }}
            >
              返回调整
            </button>
            {proposal.routes === null ? (
              <button
                type="button"
                className="button primary"
                disabled={pending || proposal.conflicts.length > 0}
                onClick={queryRoutes}
              >
                {pending ? "正在查询" : "查询受影响路线"}
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={
                  pending ||
                  proposal.conflicts.length > 0 ||
                  proposal.effectiveDraft.status === "infeasible"
                }
                onClick={confirm}
              >
                确认修改
              </button>
            )}
          </div>
        </section>
      )}
      {error && (
        <p className="notice danger" role="alert" aria-label="行程修改失败">
          {error} 当前行程未改变。
        </p>
      )}
    </dialog>
  );
}
