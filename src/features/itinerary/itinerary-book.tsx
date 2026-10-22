"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ArrowUpRight,
  Clock3,
  Footprints,
  Map,
  MapPin,
  Utensils,
  CalendarDays,
  Users,
} from "lucide-react";
import type { Itinerary } from "@/domain/itinerary";
import type { Day } from "@/domain/models";
import { formatMinute } from "@/domain/draft";
import {
  briefBudget,
  dailyBudgetTargetFen,
  tripPurposeLabels,
} from "@/domain/trip-brief";
import { RouteMap } from "@/features/map/route-map";
import { useWideScreen } from "@/features/map/use-wide-screen";

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
}: {
  plan: Itinerary;
  mapKey: string;
  mapsConfigured: boolean;
  onEdit: () => void;
}) {
  const [active, setActive] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [mapOpen, setMapOpen] = useState(false);
  const wide = useWideScreen();
  const select = useCallback((id: string) => setSelected(id), []);
  useEffect(() => {
    if (mapOpen && !wide) {
      document.getElementById("trip-day-heading")?.scrollIntoView({ block: "start" });
    }
  }, [mapOpen, wide]);
  const day = plan.days[active];
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
  return (
    <div className={`trip-book${mapOpen ? " is-map-open" : ""}`}>
      <section className="trip-cover" aria-label="完整旅行方案总览">
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
          <span className="trip-nav-label">每天，慢慢展开</span>
          {plan.days.map((value, index) => (
            <button
              key={value.date}
              type="button"
              aria-current={active === index ? "date" : undefined}
              onClick={() => {
                setActive(index);
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
          {day.notices.length > 0 && (
            <details className="trip-day-notices">
              <summary>{day.notices.length} 项用餐／交通说明</summary>
              {day.notices.map((notice, index) => (
                <p key={index}>{notice}</p>
              ))}
            </details>
          )}
          <ol className="trip-timeline">
            {schedule?.items.map((item, index) => {
              const recommendation = day.recommendations.find(
                (value) => value.activityId === item.activity.id,
              );
              const leg = index > 0 ? schedule.legs[index - 1] : null;
              return (
                <li key={item.activity.id}>
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
                    className={`trip-activity ${selected === item.activity.id ? "is-selected" : ""}`}
                  >
                    <div className="trip-activity-top">
                      <time>{formatMinute(item.startMinute)}</time>
                      <span>
                        {purposes[item.activity.kind]} · 建议 {item.activity.stayMinutes}{" "}
                        分钟
                      </span>
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
                    <details className="trip-place-evidence">
                      <summary>地址、来源与核实事项</summary>
                      <p>{item.activity.place.address ?? "地址未知"}</p>
                      <p>
                        地点来源：
                        {item.activity.place.source.kind === "fixture"
                          ? "测试 fixture"
                          : item.activity.place.source.kind === "user"
                            ? "用户记录"
                            : "高德地点查询"}{" "}
                        · {item.activity.place.source.queriedAt}
                      </p>
                      <p>
                        安排与菜品为 AI 建议；
                        {item.activity.kind === "visit" ? "门票" : "餐费"}
                        、当日营业与预约未知，不代表免费或已确认。
                      </p>
                    </details>
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
          {(wide || mapOpen) && mapDay.items.length > 0 && (
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
              第 {active + 1} 天均分参考目标{" "}
              {money(dailyBudgetTargetFen(plan.brief, active))}（全体）
            </p>
            <p>
              图中为目标分配建议，不是已查询价格。每日金额仅均分参考，非当日实际费用；实际支出未知，不能据此认定预算充足，零目标也不代表免费。
            </p>
          </section>
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
