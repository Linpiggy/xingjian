"use client";
import { useCallback, useRef } from "react";
import { useMutation } from "@tanstack/react-query";
import { Compass, Footprints, Info, MapPin, Plus, X, CloudOff } from "lucide-react";
import type { Draft, Place, TripInput } from "@/domain/models";
import { formatMinute } from "@/domain/draft";
import { planResponseSchema } from "@/lib/contracts";
import { TripForm } from "@/features/trip-form/trip-form";
import { RouteMap } from "@/features/map/route-map";
import { useWideScreen } from "@/features/map/use-wide-screen";
import { usePlannerUi } from "./ui-store";

function money(fen: number) {
  return new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(fen / 100);
}
function PlaceDetails({ place }: { place: Place }) {
  return (
    <>
      <div className="detail-place">
        <MapPin size={24} aria-hidden="true" />
        <h3>{place.name}</h3>
        <p>{place.address ?? "地址未知"}</p>
      </div>
      <hr />
      <h3>来源与核实</h3>
      <dl className="facts">
        <dt>数据来源</dt>
        <dd>
          {place.source.kind === "fixture"
            ? "测试 fixture，非实时"
            : place.source.kind === "user"
              ? "用户地图选点，未经 POI 核实"
              : "高德地点查询"}
        </dd>
        <dt>记录时间</dt>
        <dd>
          <time dateTime={place.source.queriedAt}>
            {new Intl.DateTimeFormat("zh-CN", {
              timeZone: "Asia/Shanghai",
              dateStyle: "short",
              timeStyle: "short",
            }).format(new Date(place.source.queriedAt))}
          </time>
        </dd>
        <dt>坐标系</dt>
        <dd>GCJ-02</dd>
        <dt>营业描述</dt>
        <dd>{place.openingHours ?? "未知"}</dd>
        <dt>预约要求</dt>
        <dd>尚未核实</dd>
        <dt>门票价格</dt>
        <dd>未知，不代表免费</dd>
      </dl>
      <div className="notice">
        <Info size={18} aria-hidden="true" />
        <p>营业描述不等于出行日开放保证；预约与费用需另行确认。</p>
      </div>
      <a
        className="text-link"
        href="https://lbs.amap.com/api/webservice/guide/api-advanced/newpoisearch"
        target="_blank"
        rel="noreferrer"
      >
        查看接口来源说明
      </a>
    </>
  );
}
function Workspace({
  draft,
  mapKey,
  mapsConfigured,
}: {
  draft: Draft;
  mapKey: string;
  mapsConfigured: boolean;
}) {
  const ui = usePlannerUi();
  const wideScreen = useWideScreen();
  const dialog = useRef<HTMLDialogElement>(null);
  const select = ui.select;
  const selectPlace = useCallback(
    (id: string) => {
      select(id);
      if (window.matchMedia("(max-width: 1100px)").matches) {
        dialog.current?.showModal();
      }
    },
    [select],
  );
  const day = draft.days[ui.dayIndex] ?? draft.days[0];
  if (!day) {
    return (
      <section className="panel">
        <h2>还没有行程</h2>
        <p>请新建计划，填写目的地和地点。</p>
      </section>
    );
  }
  const selected =
    day.items.find((item) => item.place.id === ui.selectedId)?.place ??
    day.items[0]?.place;
  const fixtures = draft.days.some((d) =>
    d.items.some((item) => item.place.source.kind === "fixture"),
  );
  return (
    <>
      <div className="workspace-title">
        <div>
          <h1>
            {draft.input.city}
            {draft.input.dayCount}日路线草稿
          </h1>
          <p>
            {draft.input.startDate} 起 / {draft.input.travelers} 人 / 步行优先
          </p>
        </div>
        <span className="status-tag">
          {draft.status === "infeasible" ? "存在时间冲突" : "待核实草稿"}
        </span>
      </div>
      {fixtures && (
        <div className="notice warning" role="status">
          测试 fixture：此页面数据不是真实接口查询。
        </div>
      )}
      <div className="notice workspace-notice">
        <Info size={18} aria-hidden="true" />
        <p>{draft.notices[0]}</p>
      </div>
      <div className="mobile-tabs" role="group" aria-label="工作台视图">
        <button
          className={ui.mobileTab === "itinerary" ? "active" : ""}
          aria-pressed={ui.mobileTab === "itinerary"}
          onClick={() => ui.changeTab("itinerary")}
        >
          行程
        </button>
        <button
          className={ui.mobileTab === "map" ? "active" : ""}
          aria-pressed={ui.mobileTab === "map"}
          onClick={() => ui.changeTab("map")}
        >
          地图
        </button>
      </div>
      <div className="workspace-grid" data-view={ui.mobileTab}>
        <section className="panel itinerary-panel" aria-label="每日行程">
          <h2>每日行程</h2>
          <div className="day-tabs" role="group" aria-label="选择旅行日期">
            {draft.days.map((d, index) => (
              <button
                key={d.date}
                className={index === ui.dayIndex ? "active" : ""}
                aria-pressed={index === ui.dayIndex}
                onClick={() => ui.changeDay(index)}
              >
                第 {index + 1} 天
              </button>
            ))}
          </div>
          <p className="small muted">{day.date} / 09:00 出发估算</p>
          <ol className="timeline">
            {day.items.map((item, index) => {
              const leg = day.legs[index - 1];
              return (
                <li key={item.place.id}>
                  {index > 0 && (
                    <div className={`travel-leg ${leg?.route ? "" : "error-text"}`}>
                      <Footprints size={16} aria-hidden="true" />
                      <span>
                        {leg?.route
                          ? `${leg.route.seconds === null ? "耗时未知" : `约 ${Math.ceil(leg.route.seconds / 60)} 分钟`} / ${leg.route.meters === null ? "距离未知" : `${(leg.route.meters / 1000).toFixed(1)} km`}`
                          : `交通未校验：${leg?.error ?? "没有路线"}`}
                      </span>
                    </div>
                  )}
                  <button
                    className={`stop-card ${selected?.id === item.place.id ? "selected" : ""}`}
                    aria-pressed={selected?.id === item.place.id}
                    onClick={() => selectPlace(item.place.id)}
                  >
                    <span className="stop-time">{formatMinute(item.startMinute)}</span>
                    <span>
                      <strong>{item.place.name}</strong>
                      <small>停留 {item.stayMinutes} 分钟（用户估算）</small>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          {day.issues.map((issue) => (
            <p className="notice warning" key={issue} role="status">
              {issue}
            </p>
          ))}
          <div className="incomplete">
            <h3>午餐与晚餐待安排</h3>
            <p>本轮未自动选择餐厅，不把空档当作完整行程。</p>
          </div>
          <p className="small muted">{draft.notices[1]}</p>
        </section>
        <section className="panel map-panel">
          <div>
            <h2>当天真实路线</h2>
            <p className="small muted">点位与路线使用 GCJ-02；不绘制虚构连线。</p>
          </div>
          {wideScreen || ui.mobileTab === "map" ? (
            <RouteMap
              day={day}
              selectedId={selected?.id ?? null}
              onSelect={selectPlace}
              mapKey={mapKey}
              configured={mapsConfigured}
            />
          ) : (
            <div className="map-stage">
              <div className="map-state">
                <p>切换到地图视图后加载。</p>
              </div>
            </div>
          )}
          <div className="notice">
            <CloudOff size={18} aria-hidden="true" />
            <p>天气未接入。没有实际预报，不推断雨天方案。</p>
          </div>
          {day.legs.some((leg) => leg.route && !leg.route.segments.length) && (
            <p className="notice warning">部分路段缺少路线点串，未在地图上绘制。</p>
          )}
          {draft.notices.slice(2).map((notice) => (
            <p className="small muted" key={notice}>
              {notice}
            </p>
          ))}
        </section>
        <aside className="panel details-sidebar" aria-label="地点详情">
          <h2>地点详情</h2>
          {selected ? <PlaceDetails place={selected} /> : <p>选择一个地点查看详情。</p>}
          <hr />
          <h3>预算目标</h3>
          <p className="budget-number">{money(draft.input.budgetPerPersonFen)} / 人</p>
          <p className="small muted">
            住宿、餐饮、门票和交通费用尚未汇总；这不是预计实际支出。
          </p>
        </aside>
      </div>
      <dialog
        ref={dialog}
        className="details-dialog"
        aria-labelledby="place-dialog-title"
      >
        <div className="dialog-heading">
          <h2 id="place-dialog-title">地点详情</h2>
          <button
            className="icon-button"
            aria-label="关闭地点详情"
            onClick={() => dialog.current?.close()}
          >
            <X size={20} />
          </button>
        </div>
        {selected && <PlaceDetails place={selected} />}
      </dialog>
      <footer className="workspace-footer">
        <span>本页草稿，尚未保存</span>
        <span>拖拽、锁定、修改预览与分享将在后续阶段实现</span>
      </footer>
    </>
  );
}
export function Planner({
  startDate,
  mapKey,
  mapsConfigured,
}: {
  startDate: string;
  mapKey: string;
  mapsConfigured: boolean;
}) {
  const resetUi = usePlannerUi((state) => state.reset);
  const mutation = useMutation({
    mutationFn: async (input: TripInput) => {
      const response = await fetch("/api/plans", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(90_000),
      });
      const data: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof data === "object" &&
          data !== null &&
          "message" in data &&
          typeof data.message === "string"
            ? data.message
            : "查询失败，请稍后重试。";
        throw new Error(message);
      }
      const result = planResponseSchema.safeParse(data);
      if (!result.success) {
        throw new Error("服务返回格式异常，未使用无效数据生成行程。");
      }
      return result.data.draft;
    },
    onSuccess: () => resetUi(),
  });
  function newPlan() {
    if (mutation.data && !window.confirm("当前草稿未保存，确定清空并新建计划吗？")) {
      return;
    }
    mutation.reset();
    resetUi();
  }
  return (
    <>
      <header className="site-header">
        <span className="brand">
          <span className="brand-icon">
            <Compass size={22} aria-hidden="true" />
          </span>
          行间
        </span>
        <span className="header-description">旅行规划</span>
        <button className="button" disabled={mutation.isPending} onClick={newPlan}>
          <Plus size={18} aria-hidden="true" />
          新建计划
        </button>
      </header>
      <main id="main" className={mutation.data ? "workspace-shell" : "form-shell"}>
        {mutation.data ? (
          <Workspace
            draft={mutation.data}
            mapKey={mapKey}
            mapsConfigured={mapsConfigured}
          />
        ) : (
          <>
            <div className="page-heading">
              <h1>把想去的地方，排进合适的一天。</h1>
              <p>先从真实地点和路线开始。未知的信息，留待核实。</p>
            </div>
            <TripForm
              startDate={startDate}
              mapKey={mapKey}
              mapsConfigured={mapsConfigured}
              pending={mutation.isPending}
              error={
                mutation.error
                  ? mutation.error instanceof Error &&
                    mutation.error.name === "TimeoutError"
                    ? "查询超时，请稍后重试。"
                    : mutation.error.message
                  : null
              }
              onSubmit={(input) => mutation.mutate(input)}
            />
          </>
        )}
      </main>
    </>
  );
}
