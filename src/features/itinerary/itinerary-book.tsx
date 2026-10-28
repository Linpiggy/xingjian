"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import {
  ArrowUpRight,
  Clock3,
  Footprints,
  Map,
  MapPin,
  Utensils,
  CalendarDays,
  Users,
  ChevronRight,
  Lock,
  CloudSun,
  GripVertical,
} from "lucide-react";
import type { Itinerary } from "@/domain/itinerary";
import { socialNoteUrl } from "@/domain/social-inspiration";
import type { Day } from "@/domain/models";
import { formatMinute } from "@/domain/draft";
import {
  briefBudget,
  dailyBudgetTargetFen,
  tripPurposeLabels,
} from "@/domain/trip-brief";
import { RouteMap } from "@/features/map/route-map";
import { useWideScreen } from "@/features/map/use-wide-screen";
import { PlaceDetailsDialog } from "./place-details-dialog";
import type { ItineraryChange } from "@/domain/itinerary-editing";
import { WeatherPanel } from "@/features/planner/weather-panel";
import { ItineraryExpenseSummary } from "./itinerary-expense-view";
import { ItineraryExpenseDialog } from "./itinerary-expense-dialog";

const money = (fen: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    fen / 100,
  );
const labels = {
  intercity: "跨城往返",
  local: "市内交通",
  lodging: "住宿",
  meals: "三餐",
  tickets: "门票",
};
const purposes = { visit: "游览", breakfast: "早餐", lunch: "午餐", dinner: "晚餐" };
const colors = ["#203e35", "#4c7566", "#819c8c", "#b2bfa8", "#d9dfd2"];
export function ItineraryBook({
  plan,
  mapKey,
  mapsConfigured,
  onEdit,
  onActivityChange,
  active = true,
}: {
  plan: Itinerary;
  mapKey: string;
  mapsConfigured: boolean;
  onEdit: () => void;
  onActivityChange?: (change: ItineraryChange) => void;
  active?: boolean;
}) {
  const [dayIndex, setDayIndex] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [detailMoveOpen, setDetailMoveOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const drag = useRef<{ plan: Itinerary; activityId: string } | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    index: number;
    edge: "before" | "after";
  } | null>(null);
  const wide = useWideScreen();
  useEffect(() => {
    if (moveError) {
      document.getElementById("trip-move-error")?.focus();
    }
  }, [moveError]);
  const select = useCallback((id: string) => setSelected(id), []);
  useEffect(() => {
    if (mapOpen && !wide) {
      document.getElementById("trip-day-heading")?.scrollIntoView({ block: "start" });
    }
  }, [mapOpen, wide]);
  const currentDay = Math.min(dayIndex, plan.days.length - 1);
  const day = plan.days[currentDay];
  const schedule = day.schedule;
  const total = briefBudget(plan.brief).totalFen;
  const mapDay: Day = useMemo(
    () => ({
      date: day.date,
      items:
        day.schedule?.items.map((item) => ({
          activityId: item.activity.id,
          purpose: item.activity.kind,
          place: item.activity.place,
          startMinute: item.startMinute,
          endMinute: item.endMinute,
          stayMinutes: item.activity.stayMinutes,
        })) ?? [],
      legs:
        day.schedule?.legs.map((leg, index) => ({
          fromId: day.schedule!.items[index].activity.place.id,
          toId: day.schedule!.items[index + 1].activity.place.id,
          route: leg.route,
          error: leg.route ? null : "交通耗时待核实",
        })) ?? [],
      issues: day.schedule?.issues.map((issue) => issue.message) ?? [],
    }),
    [day],
  );
  let cursor = 0;
  const stops = plan.allocation.map((item, index) => {
    const from = cursor;
    cursor += total ? (item.targetFen / total) * 100 : 0;
    return `${colors[index]} ${from.toFixed(4)}% ${cursor.toFixed(4)}%`;
  });
  const selectedItem = schedule?.items.find((item) => item.activity.id === selected);
  const detailItem = schedule?.items.find((item) => item.activity.id === detailId);
  const closeDetails = useCallback(() => setDetailId(null), []);
  function dragOver(event: DragEvent<HTMLElement>, index: number) {
    event.preventDefault();
    if (
      !wide ||
      !onActivityChange ||
      drag.current?.plan !== plan ||
      !event.dataTransfer.types.includes("application/x-xingjian-activity")
    ) {
      event.dataTransfer.dropEffect = "none";
      return;
    }
    event.dataTransfer.dropEffect = "move";
    const box = event.currentTarget.getBoundingClientRect();
    const edge = event.clientY < box.top + box.height / 2 ? "before" : "after";
    setDropTarget((previous) =>
      previous?.index === index && previous.edge === edge ? previous : { index, edge },
    );
  }
  function drop(event: DragEvent<HTMLElement>, index: number) {
    event.preventDefault();
    const source = drag.current;
    drag.current = null;
    setDropTarget(null);
    if (
      !wide ||
      !onActivityChange ||
      !source ||
      source.plan !== plan ||
      event.dataTransfer.getData("application/x-xingjian-activity") !== source.activityId
    ) {
      setMoveError("请使用行程内的调整操作；未应用外部拖入的内容。");
      return;
    }
    const fromDay = plan.days.findIndex((day) =>
      day.schedule?.items.some((item) => item.activity.id === source.activityId),
    );
    const fromIndex =
      plan.days[fromDay]?.schedule?.items.findIndex(
        (item) => item.activity.id === source.activityId,
      ) ?? -1;
    const box = event.currentTarget.getBoundingClientRect();
    let toIndex = index + (event.clientY < box.top + box.height / 2 ? 0 : 1);
    if (fromDay === currentDay && fromIndex < toIndex) {
      toIndex -= 1;
    }
    if (fromDay === currentDay && fromIndex === toIndex) {
      return;
    }
    try {
      onActivityChange({
        kind: "move",
        activityId: source.activityId,
        toDay: currentDay,
        toIndex,
      });
      setMoveError(null);
    } catch (cause) {
      setMoveError(cause instanceof Error ? cause.message : "移动未应用，请重试。");
    }
  }
  return (
    <div className={`trip-book${mapOpen ? " is-map-open" : ""}`}>
      <section className="trip-cover" aria-label="完整旅行方案总览">
        <p className="trip-cover-city">{plan.brief.destinationCity} · 旅行提案</p>
        <div className="trip-cover-meta">
          <span>{tripPurposeLabels[plan.brief.mainPurpose]}</span>
          <span>
            {plan.status === "infeasible" ? "存在需要调整的冲突" : "时间与费用仍待核实"}
          </span>
        </div>
        <h1 tabIndex={-1} id="itinerary-heading">
          {plan.title}
        </h1>
        <p className="trip-cover-intro">{plan.summary}</p>
        <div className="trip-cover-bottom">
          <div className="trip-cover-facts">
            <span>
              <MapPin size={16} aria-hidden="true" />
              {plan.brief.destinationCity}
            </span>
            <span>
              <CalendarDays size={16} aria-hidden="true" />
              {plan.brief.startDate} · {plan.brief.dayCount} 天
            </span>
            <span>
              <Users size={16} aria-hidden="true" />
              {plan.brief.travelers} 人
            </span>
            <span>全体预算目标 {money(total)}</span>
          </div>
          <button className="button" onClick={onEdit}>
            调整旅行需求 <ArrowUpRight size={15} aria-hidden="true" />
          </button>
        </div>
      </section>
      {plan.fixture && (
        <p className="trip-fixture" role="status">
          测试 fixture：此方案用于离线交互验证，不是真实接口规划结果。
        </p>
      )}
      <div className="trip-book-grid">
        <nav className="trip-day-nav" aria-label="选择行程日期">
          <span className="trip-nav-label">每日行程</span>
          {plan.days.map((value, index) => (
            <button
              key={value.date}
              type="button"
              aria-current={currentDay === index ? "date" : undefined}
              onClick={() => {
                setDayIndex(index);
                setSelected(null);
              }}
            >
              <span>第 {index + 1} 天</span>
              <small>{value.date.slice(5).replace("-", ".")}</small>
            </button>
          ))}
        </nav>
        <section className="trip-day-content" aria-label="当日完整安排">
          <div className="trip-day-heading" id="trip-day-heading">
            <div>
              <span>{day.date} · 上海时区</span>
              <h2>{day.theme}</h2>
            </div>
            <button
              className="button trip-mobile-map"
              aria-pressed={mapOpen}
              onClick={() => setMapOpen(!mapOpen)}
            >
              <Map size={16} aria-hidden="true" />
              {mapOpen ? "收起地图" : "查看地图"}
            </button>
          </div>
          <p className="trip-timing-note">
            时间按实际有向步行耗时、建议停留与独立 10
            分钟缓冲推算；营业、预约与菜品供应尚未核实。
          </p>
          {moveError && (
            <p id="trip-move-error" tabIndex={-1} className="trip-error" role="alert">
              {moveError}
            </p>
          )}
          {day.notices.length > 0 && (
            <details className="trip-day-notices">
              <summary>{day.notices.length} 项用餐／交通说明</summary>
              {day.notices.map((notice, index) => (
                <p key={index}>{notice}</p>
              ))}
            </details>
          )}
          <ol className="trip-timeline" key={day.date}>
            {schedule?.items.map((item, index) => {
              const recommendation = day.recommendations.find(
                (value) => value.activityId === item.activity.id,
              );
              const leg = index > 0 ? schedule.legs[index - 1] : null;
              return (
                <li key={item.activity.id} style={{ animationDelay: `${index * 35}ms` }}>
                  {leg && (
                    <p className="trip-transfer">
                      <Footprints size={14} aria-hidden="true" />
                      {leg.route?.seconds == null
                        ? "步行耗时待核实，后续时间未知"
                        : `步行约 ${Math.ceil(leg.route.seconds / 60)} 分钟${leg.route.meters == null ? "" : ` · ${(leg.route.meters / 1000).toFixed(1)} km`}`}
                      <span>另留 10 分钟缓冲</span>
                    </p>
                  )}
                  <article
                    className={`trip-activity ${selected === item.activity.id ? "is-selected" : ""} ${wide && onActivityChange && item.activity.kind === "visit" ? "has-drag-handle" : ""} ${dropTarget?.index === index ? `is-drop-${dropTarget.edge}` : ""}`}
                    onDragOver={(event) => dragOver(event, index)}
                    onDragLeave={(event) => {
                      if (!(
                        event.relatedTarget instanceof Node &&
                        event.currentTarget.contains(event.relatedTarget)
                      )) {
                        setDropTarget(null);
                      }
                    }}
                    onDrop={(event) => drop(event, index)}
                  >
                    {wide && onActivityChange && item.activity.kind === "visit" && (
                      <button
                        type="button"
                        className="trip-drag-handle"
                        aria-label={`调整${item.activity.place.name}的位置`}
                        title="拖动调整当天次序，或点击选择日期与位置"
                        disabled={item.activity.positionLocked}
                        draggable={!item.activity.positionLocked}
                        onClick={() => {
                          if (item.activity.positionLocked) {
                            return;
                          }
                          setMoveError(null);
                          setDetailMoveOpen(true);
                          setSelected(item.activity.id);
                          setDetailId(item.activity.id);
                        }}
                        onDragStart={(event) => {
                          if (item.activity.positionLocked) {
                            event.preventDefault();
                            return;
                          }
                          drag.current = { plan, activityId: item.activity.id };
                          setMoveError(null);
                          event.dataTransfer.setData(
                            "application/x-xingjian-activity",
                            item.activity.id,
                          );
                          event.dataTransfer.effectAllowed = "move";
                          const article = event.currentTarget.closest("article");
                          if (article) {
                            event.dataTransfer.setDragImage(article, 20, 20);
                          }
                        }}
                        onDragEnd={() => {
                          drag.current = null;
                          setDropTarget(null);
                        }}
                      >
                        <GripVertical size={18} aria-hidden="true" />
                      </button>
                    )}
                    <div className="trip-activity-top">
                      <time>{formatMinute(item.startMinute)}</time>
                      <span>
                        {purposes[item.activity.kind]} · 建议 {item.activity.stayMinutes}{" "}
                        分钟
                      </span>
                      {item.activity.positionLocked && (
                        <span className="trip-position-lock">
                          <Lock size={12} aria-hidden="true" />
                          位置已锁
                        </span>
                      )}
                      {item.activity.fixedStartMinute !== null && (
                        <span className="trip-time-lock">
                          <Lock size={12} aria-hidden="true" />
                          时间锁 {formatMinute(item.activity.fixedStartMinute)}
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      className="trip-place-select"
                      aria-pressed={selected === item.activity.id}
                      onClick={() => select(item.activity.id)}
                    >
                      <span>
                        {item.activity.kind === "visit" ? (
                          <MapPin size={17} aria-hidden="true" />
                        ) : (
                          <Utensils size={17} aria-hidden="true" />
                        )}
                        {item.activity.place.name}
                      </span>
                      <ArrowUpRight size={17} aria-hidden="true" />
                    </button>
                    {recommendation?.dish && (
                      <p className="trip-dish">
                        菜品建议 · {recommendation.dish}
                        <small>供应与饮食适配需向商家核实</small>
                      </p>
                    )}
                    <p className="trip-reason">{recommendation?.reason}</p>
                    {recommendation?.guide && (
                      <p className="trip-experience">
                        <span>
                          AI {item.activity.kind === "visit" ? "游玩" : "用餐"}建议
                        </span>
                        {recommendation.guide.experience}
                      </p>
                    )}
                    <button
                      type="button"
                      className="trip-place-evidence"
                      aria-label={`查看${item.activity.place.name}的资料`}
                      onClick={() => {
                        select(item.activity.id);
                        setMoveError(null);
                        setDetailMoveOpen(false);
                        setDetailId(item.activity.id);
                      }}
                    >
                      {recommendation?.guide
                        ? "详细建议、地址与核实事项"
                        : "地址、来源与核实事项"}{" "}
                      <ChevronRight size={12} aria-hidden="true" />
                    </button>
                  </article>
                </li>
              );
            })}
          </ol>
          {schedule && (
            <details className="trip-day-notices">
              <summary>{schedule.issues.length} 项行程核实与冲突</summary>
              {schedule.issues.map((issue, index) => (
                <p
                  className={issue.severity === "conflict" ? "trip-conflict" : ""}
                  key={index}
                >
                  {issue.message}
                </p>
              ))}
            </details>
          )}
        </section>
        <aside className="trip-map-aside" aria-label="路线与费用概览">
          {active && (wide || mapOpen) && mapDay.items.length > 0 && (
            <section className="trip-map-panel">
              <div>
                <h2>把今天放在地图上</h2>
                <span>
                  {selectedItem?.activity.place.name ?? "选择行程中的地点，与地图联动"}
                </span>
              </div>
              <RouteMap
                day={mapDay}
                selectedId={selected}
                onSelect={select}
                mapKey={mapKey}
                configured={mapsConfigured}
              />
            </section>
          )}
          <section className="trip-budget-panel" aria-label="预算目标分配">
            <div className="trip-budget-heading">
              <WalletMark />
              <div>
                <h2>留好预算，也留好余地</h2>
                <p>全体目标 {money(total)}，不是实际报价</p>
              </div>
            </div>
            <div className="trip-budget-visual">
              <div
                className="trip-donut"
                style={{
                  background: total
                    ? `conic-gradient(${stops.join(",")})`
                    : "var(--border)",
                }}
              >
                <div>
                  <span>目标分配</span>
                  <strong>{plan.brief.travelers} 人</strong>
                </div>
              </div>
              <dl>
                {plan.allocation.map((item, index) => (
                  <div key={item.category}>
                    <dt>
                      <i style={{ background: colors[index] }} />
                      {labels[item.category]}
                    </dt>
                    <dd>
                      {(item.category === "intercity" &&
                        !plan.brief.budget.includeIntercity) ||
                      (item.category === "lodging" && !plan.brief.budget.includeLodging)
                        ? "未计入"
                        : money(item.targetFen)}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
            <p className="trip-daily-target">
              第 {currentDay + 1} 天均分参考目标{" "}
              {money(dailyBudgetTargetFen(plan.brief, currentDay))}（全体）
            </p>
            <p>
              图中为目标分配建议，不是已查询价格。每日金额仅均分参考，非当日实际费用；实际支出未知，不能据此认定预算充足，零目标也不代表免费。
            </p>
            <details className="trip-expense-details">
              <summary>查看或补充手动费用估算</summary>
              <ItineraryExpenseSummary plan={plan} />
              {onActivityChange && (
                <button
                  type="button"
                  className="button"
                  onClick={() => setExpenseOpen(true)}
                >
                  编辑全程费用估算
                </button>
              )}
            </details>
          </section>
          <details
            className="trip-weather-disclosure"
            onToggle={(event) => setWeatherOpen(event.currentTarget.open)}
          >
            <summary>
              <CloudSun size={17} aria-hidden="true" />
              当天天气与出行提示
            </summary>
            {weatherOpen &&
              (mapDay.items[0] ? (
                <WeatherPanel
                  key={`${day.date}:${mapDay.items[0].place.id}:${mapDay.items[0].place.location.join(",")}`}
                  date={day.date}
                  place={mapDay.items[0].place}
                />
              ) : (
                <p>当天没有活动参考点，天气未知；不会用其他日期或位置替代。</p>
              ))}
          </details>
        </aside>
      </div>
      <details className="trip-final-details">
        <summary>必去／必吃覆盖与出行前核实</summary>
        {plan.constraints.map((item, index) => (
          <p className={item.status === "conflict" ? "trip-conflict" : ""} key={index}>
            <strong>{item.label}</strong> · {item.message}
          </p>
        ))}
        {plan.notices.map((notice, index) => (
          <p key={index}>{notice}</p>
        ))}
        <p>
          AI 模型：{plan.model} · 生成时间：{plan.generatedAt}
        </p>
      </details>
      {plan.brief.socialInspiration && (
        <details className="trip-final-details" aria-label="社交参考来源">
          <summary>
            社交参考来源 · {plan.brief.socialInspiration.notes.length} 篇选用摘录
          </summary>
          <p>
            这是用户选用、供模型参考的未核实经验，不是逐活动采用证明，也不确认营业、价格、过敏安全或图片使用权。规范链接不携带访问令牌，可能需在平台内查看。
          </p>
          {plan.brief.socialInspiration.notes.map((note) => (
            <div className="trip-social-reference" key={note.noteId}>
              <a href={socialNoteUrl(note)} target="_blank" rel="noreferrer noopener">
                {note.title}
              </a>
              <p>{note.excerpt}</p>
              <p>
                笔记自带时间（未核实）：{note.publishedAt ?? "未知"} · 导入记录：
                {note.importedAt}
              </p>
              {note.places.length > 0 && (
                <p>
                  用户希望检索的候选：{note.places.map((place) => place.name).join("、")}
                  ；不代表全部已安排。
                </p>
              )}
            </div>
          ))}
        </details>
      )}
      {expenseOpen && onActivityChange && (
        <ItineraryExpenseDialog
          plan={plan}
          onClose={() => setExpenseOpen(false)}
          onPropose={(change) => {
            onActivityChange(change);
            setExpenseOpen(false);
          }}
        />
      )}
      {detailItem && (
        <PlaceDetailsDialog
          item={detailItem}
          date={day.date}
          dish={
            day.recommendations.find((item) => item.activityId === detailId)?.dish ?? null
          }
          guide={day.recommendations.find((item) => item.activityId === detailId)?.guide}
          onClose={closeDetails}
          initialMoveOpen={detailMoveOpen}
          onChange={
            onActivityChange
              ? (change) => {
                  onActivityChange(change);
                  setDetailId(null);
                }
              : undefined
          }
          moveDays={plan.days.map((day) => ({
            date: day.date,
            available: day.schedule !== null,
            items: (day.schedule?.items ?? []).map((item) => ({
              id: item.activity.id,
              name: item.activity.place.name,
            })),
          }))}
        />
      )}
      <p className="trip-page-footnote">
        <Clock3 size={14} aria-hidden="true" />
        行程暂存于当前页面，刷新会清空。时间为估算，开放、预约、天气和实际费用请在出行前再次确认。
      </p>
    </div>
  );
}
function WalletMark() {
  return (
    <span className="trip-wallet-mark" aria-hidden="true">
      ¥
    </span>
  );
}
