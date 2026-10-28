"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { ScheduledActivity } from "@/domain/meal-planning";
import { formatMinute } from "@/domain/draft";
import type { ItineraryChange } from "@/domain/itinerary-editing";
import { ItineraryVenueEditor } from "./itinerary-venue-editor";

export function PlaceDetailsDialog({
  item,
  date,
  dish,
  onClose,
  onChange,
  moveDays,
  initialMoveOpen = false,
}: {
  item: ScheduledActivity;
  date: string;
  dish: string | null;
  onClose: () => void;
  onChange?: (change: ItineraryChange) => void;
  initialMoveOpen?: boolean;
  moveDays?: {
    date: string;
    available: boolean;
    items: { id: string; name: string }[];
  }[];
}) {
  const [moveExpanded, setMoveExpanded] = useState(initialMoveOpen);
  const originDay = Math.max(
    0,
    moveDays?.findIndex((day) =>
      day.items.some((value) => value.id === item.activity.id),
    ) ?? 0,
  );
  const [moveDay, setMoveDay] = useState(originDay);
  const [moveIndex, setMoveIndex] = useState(
    moveDays?.[originDay]?.items.findIndex((value) => value.id === item.activity.id) ?? 0,
  );
  const positions =
    moveDays?.[moveDay]?.items.filter((value) => value.id !== item.activity.id) ?? [];
  const [error, setError] = useState<string | null>(null);
  const skipRestore = useRef(false);
  function propose(change: ItineraryChange) {
    try {
      skipRestore.current = true;
      onChange?.(change);
      ref.current?.close();
    } catch (cause) {
      skipRestore.current = false;
      setError(cause instanceof Error ? cause.message : "修改未应用，请重试。");
    }
  }
  function duration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const stayMinutes = Number(new FormData(event.currentTarget).get("stayMinutes"));
    if (!Number.isInteger(stayMinutes) || stayMinutes < 15 || stayMinutes > 240) {
      setError("建议停留须为 15—240 分钟的整数。");
      return;
    }
    propose({ kind: "duration", activityId: item.activity.id, stayMinutes });
  }
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement;
    if (!dialog) {
      return;
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    const header = dialog.querySelector<HTMLElement>(".trip-detail-header");
    const measureHeader = () => {
      dialog.style.setProperty(
        "--trip-detail-title-height",
        `${header?.getBoundingClientRect().height ?? 0}px`,
      );
    };
    measureHeader();
    const observer = new ResizeObserver(measureHeader);
    if (header) {
      observer.observe(header);
    }
    dialog.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      observer.disconnect();
      dialog.close();
      document.body.style.overflow = overflow;
      if (
        !skipRestore.current &&
        previous instanceof HTMLElement &&
        previous.isConnected
      ) {
        previous.focus({ preventScroll: true });
      }
    };
  }, []);
  const source = item.activity.place.source;
  const rules = item.activity.rules;
  const reservationLabels = {
    unknown: "未知",
    not_required: "用户记录无需预约",
    required_unconfirmed: "需预约，尚未取得",
    confirmed: "用户记录已预约，非平台核验",
  };
  return (
    <dialog
      ref={ref}
      className="trip-detail-dialog"
      aria-labelledby="trip-detail-name"
      onClose={() => {
        if (!ref.current?.open) {
          onClose();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>(
          "button:not(:disabled)",
        );
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (!first || !last) {
          return;
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === event.currentTarget.querySelector("h2"))
        ) {
          event.preventDefault();
          last.focus();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < rect.left ||
          event.clientX > rect.right ||
          event.clientY < rect.top ||
          event.clientY > rect.bottom
        ) {
          event.currentTarget.close();
        }
      }}
    >
      <header className="trip-detail-header">
        <div>
          <span>地点资料 · GCJ-02</span>
          <h2 id="trip-detail-name" tabIndex={-1}>
            {item.activity.place.name}
          </h2>
        </div>
        <button
          type="button"
          className="trip-detail-close"
          aria-label="关闭地点资料"
          onClick={() => ref.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <div className="trip-detail-content">
        <h3>本次安排</h3>
        <p>
          {formatMinute(item.startMinute)}—{formatMinute(item.endMinute)} · 建议停留{" "}
          {item.activity.stayMinutes} 分钟
          {dish ? `；菜品建议：${dish}，供应及饮食适配需向商家核实。` : "。"}
        </p>
        {onChange && (
          <section className="trip-activity-edit" aria-label="调整此活动">
            <h3>调整此活动</h3>
            <form onSubmit={duration} noValidate>
              <label>
                建议停留（分钟）
                <input
                  type="number"
                  name="stayMinutes"
                  min={15}
                  max={240}
                  defaultValue={item.activity.stayMinutes}
                  onInput={() => setError(null)}
                />
              </label>
              <button type="submit" className="button">
                预览停留调整
              </button>
            </form>
            <button
              type="button"
              className="button"
              disabled={
                item.startMinute === null && item.activity.fixedStartMinute === null
              }
              onClick={() =>
                propose({
                  kind: "time_lock",
                  activityId: item.activity.id,
                  locked: item.activity.fixedStartMinute === null,
                })
              }
            >
              {item.activity.fixedStartMinute === null
                ? "预览锁定开始时间"
                : "预览解除时间锁"}
            </button>
            <button
              type="button"
              className="button"
              onClick={() =>
                propose({
                  kind: "position_lock",
                  activityId: item.activity.id,
                  locked: !item.activity.positionLocked,
                })
              }
            >
              {item.activity.positionLocked ? "预览解除位置锁" : "预览锁定位置"}
            </button>
            <p>位置锁保留此地点、日期与次序，不固定开始时间。</p>
            <p>
              {item.activity.fixedStartMinute !== null
                ? `当前时间锁：${formatMinute(item.activity.fixedStartMinute)}。`
                : item.startMinute === null
                  ? "开始时间待核实，暂不能锁定。"
                  : "时间锁仅固定本页排程，不代办商家预约。"}{" "}
              修改均先预览，确认后生效。
            </p>
            {item.activity.kind === "visit" && moveDays && (
              <details
                className="trip-move-editor"
                open={moveExpanded}
                onToggle={(event) => setMoveExpanded(event.currentTarget.open)}
              >
                <summary>顺序与跨天调整</summary>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    propose({
                      kind: "move",
                      activityId: item.activity.id,
                      toDay: moveDay,
                      toIndex: moveIndex,
                    });
                  }}
                >
                  <label>
                    移动到日期
                    <select
                      value={moveDay}
                      onChange={(event) => {
                        const index = Number(event.target.value);
                        setMoveDay(index);
                        setMoveIndex(
                          Math.min(
                            1,
                            moveDays[index].items.filter(
                              (value) => value.id !== item.activity.id,
                            ).length,
                          ),
                        );
                        setError(null);
                      }}
                    >
                      {moveDays.map((day, index) => (
                        <option
                          key={day.date}
                          value={index}
                          disabled={
                            !day.available ||
                            (index !== originDay && day.items.length >= 8)
                          }
                        >
                          第 {index + 1} 天 · {day.date}
                          {!day.available
                            ? " · 无可用时段"
                            : day.items.length >= 8 && index !== originDay
                              ? " · 活动已满"
                              : ""}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    插入位置
                    <select
                      value={moveIndex}
                      onChange={(event) => {
                        setMoveIndex(Number(event.target.value));
                        setError(null);
                      }}
                    >
                      {Array.from({ length: positions.length + 1 }, (_, index) => (
                        <option key={index} value={index}>
                          {index === 0
                            ? "当天最前"
                            : `在「${positions[index - 1].name}」之后`}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="submit"
                    className="button"
                    disabled={item.activity.positionLocked}
                  >
                    预览新位置
                  </button>
                </form>
                <p>
                  保持指定顺序，仅在预览中补查实际变化的路线。
                  {item.activity.positionLocked
                    ? "请先明确解除此活动的位置锁。"
                    : "跨天移动不能自动解除时间锁或已记录预约。"}
                </p>
              </details>
            )}
            <ItineraryVenueEditor date={date} item={item} onPropose={propose} />
            {error && (
              <p className="trip-error" role="alert">
                {error}
              </p>
            )}
          </section>
        )}
        <dl className="trip-detail-facts">
          <div>
            <dt>地点地址</dt>
            <dd>{item.activity.place.address ?? "地址未知"}</dd>
          </div>
          <div>
            <dt>数据来源</dt>
            <dd>
              {source.kind === "fixture"
                ? "测试 fixture，非真实接口结果"
                : source.kind === "user"
                  ? "用户记录"
                  : "高德地点查询"}
            </dd>
          </div>
          <div>
            <dt>查询时间</dt>
            <dd>{source.queriedAt}</dd>
          </div>
          <div>
            <dt>营业／预约</dt>
            <dd>
              {item.activity.rules
                ? "见下方用户规则记录"
                : "尚未核实，不代表已经预约或确认开放"}
            </dd>
          </div>
          <div>
            <dt>{item.activity.kind === "visit" ? "门票费用" : "餐饮费用"}</dt>
            <dd>
              {item.activity.meal?.perPersonFen != null
                ? `用户估算 ¥${(item.activity.meal.perPersonFen / 100).toFixed(2)}／人，非实时报价`
                : "未知，不代表免费"}
            </dd>
          </div>
        </dl>
        {rules && (
          <section className="trip-detail-rules">
            <h3>用户规则记录</h3>
            <p>
              适用日期：{rules.date}；营业：
              {rules.openingWindows === null
                ? "未知"
                : rules.openingWindows.length === 0
                  ? "当天闭店"
                  : rules.openingWindows
                      .map(
                        (window) =>
                          `${formatMinute(window.startMinute)}—${formatMinute(window.endMinute)}`,
                      )
                      .join("、")}
              ；最晚入场：
              {rules.lastEntryMinute === null
                ? "未知"
                : formatMinute(rules.lastEntryMinute)}
              。
            </p>
            <p>
              预约：{reservationLabels[rules.reservation.state]}；入场窗口：
              {rules.reservation.entryWindow
                ? `[${formatMinute(rules.reservation.entryWindow.startMinute)}, ${formatMinute(rules.reservation.entryWindow.endMinute)})`
                : "未知／不适用"}
              。
            </p>
            <p>用户记录（UTC）：{rules.source.recordedAt}，非商家核验。</p>
          </section>
        )}
        <h3>出行前再确认</h3>
        <p>
          活动安排与菜品是 AI
          建议。时间由建议停留、实际相邻步行与独立缓冲推算；开放、预约和饮食安全仍须向场所核实。
        </p>
        <button type="button" className="button" onClick={() => ref.current?.close()}>
          返回当天行程
        </button>
      </div>
    </dialog>
  );
}
