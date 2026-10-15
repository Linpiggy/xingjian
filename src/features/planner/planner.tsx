"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Compass, Footprints, Info, MapPin, Plus, X } from "lucide-react";
import type { Draft, Place, TripInput } from "@/domain/models";
import { formatMinute } from "@/domain/draft";
import { planResponseSchema } from "@/lib/contracts";
import { TripForm } from "@/features/trip-form/trip-form";
import { RouteMap } from "@/features/map/route-map";
import { useWideScreen } from "@/features/map/use-wide-screen";
import { usePlannerUi } from "./ui-store";
import { useDraftEditor } from "./editor-store";
import { EditDialog } from "./edit-dialog";
import { BudgetPanel } from "./budget-panel";
import { WeatherPanel } from "./weather-panel";
import { IntercityPanel } from "./intercity-panel";
import { evaluateIntercity } from "@/domain/intercity";
import { summarizeBudget } from "@/domain/budget";
import { deriveMealTrip, stopIdentity, type MealEntry } from "@/domain/meals";
import { MealPanel } from "./meal-panel";
import { VenueFacts } from "./venue-rules-fields";

function PlaceDetails({ place, meal }: { place: Place; meal?: MealEntry }) {
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
        {meal && (
          <>
            <dt>用户餐费估算</dt>
            <dd>
              {meal.meal.perPersonFen === null
                ? "未知，不按零元计算"
                : `¥${(meal.meal.perPersonFen / 100).toFixed(2)} / 人，非实时报价`}
            </dd>
            <dt>饮食核对</dt>
            <dd>
              {meal.meal.dietaryCheck === "unknown"
                ? "尚未核对"
                : meal.meal.dietaryCheck === "user_conflict"
                  ? "用户记录了饮食冲突"
                  : "用户已核对，仍须向商家确认过敏安全"}
            </dd>
            <dt>餐费／饮食记录</dt>
            <dd>
              <time dateTime={meal.meal.source.recordedAt}>
                {meal.meal.source.recordedAt}
              </time>
            </dd>
          </>
        )}
      </dl>
      {meal && <VenueFacts entries={[meal]} label="所选餐次营业预约" />}
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
        查看高德数据说明
      </a>
    </>
  );
}
function Workspace({
  draft: initialDraft,
  mapKey,
  mapsConfigured,
}: {
  draft: Draft;
  mapKey: string;
  mapsConfigured: boolean;
}) {
  const ui = usePlannerUi();
  const editor = useDraftEditor((state) => state.current);
  const draft = useMemo(
    () =>
      editor
        ? deriveMealTrip(editor.draft, editor.locks, editor.meals).draft
        : initialDraft,
    [editor, initialDraft],
  );
  const [editing, setEditing] = useState<{
    placeId: string;
    initialIndex?: number;
  } | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  function toggleLock(id: string, kind: "position" | "time") {
    try {
      useDraftEditor.getState().toggleLock(id, kind);
      setEditError(null);
    } catch (cause) {
      setEditError(cause instanceof Error ? cause.message : "未能修改锁定设置。");
    }
  }
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
  const selectedStop =
    day.items.find((item) => stopIdentity(item) === ui.selectedId) ?? day.items[0];
  const selected = selectedStop?.place;
  const selectedKey = selectedStop ? stopIdentity(selectedStop) : null;
  const selectedMeal = editor?.meals.days
    .flatMap((setting) => setting.entries)
    .find((entry) => entry.id === selectedKey);
  const budgetOver =
    editor &&
    summarizeBudget(editor.budget, draft.input.travelers, draft.input.budgetPerPersonFen)
      .status === "over";
  const intercityReport = editor
    ? evaluateIntercity(draft, editor.intercity.segments, editor.intercity.connections)
    : null;
  const fixtures = draft.days.some(
    (d) =>
      d.items.some((item) => item.place.source.kind === "fixture") ||
      d.legs.some((leg) => leg.route?.source.kind === "fixture"),
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
          {draft.status === "infeasible" || intercityReport?.status === "infeasible"
            ? "存在时间冲突"
            : budgetOver
              ? "预算估算超目标"
              : "待核实草稿"}
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
          <div className="itinerary-heading">
            <h2>每日行程</h2>
            <button
              type="button"
              className="button"
              disabled={!editor?.previous}
              onClick={() => {
                try {
                  useDraftEditor.getState().undo();
                  setEditError(null);
                } catch (cause) {
                  setEditError(cause instanceof Error ? cause.message : "未能撤销修改。");
                }
              }}
            >
              撤销修改
            </button>
          </div>
          <p className="small muted">位置锁固定当天和顺序，时间锁固定开始时间。</p>
          {editError && (
            <p className="notice danger" role="alert" aria-label="锁定修改失败">
              {editError}
            </p>
          )}
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
              const isVisit = (item.purpose ?? "visit") === "visit";
              const key = stopIdentity(item);
              return (
                <li
                  key={key}
                  onDragOver={(event) => {
                    if (isVisit) {
                      event.preventDefault();
                    }
                  }}
                  onDrop={(event) => {
                    event.preventDefault();
                    const id = event.dataTransfer.getData("text/x-travel-place");
                    if (
                      isVisit &&
                      id !== item.place.id &&
                      editor?.draft.days[ui.dayIndex].items.some(
                        (stop) => stop.place.id === id,
                      )
                    ) {
                      const visitIndex = editor.draft.days[ui.dayIndex].items.findIndex(
                        (stop) => stop.place.id === item.place.id,
                      );
                      setEditing({ placeId: id, initialIndex: visitIndex });
                    }
                  }}
                >
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
                    className={`stop-card ${selectedKey === key ? "selected" : ""}`}
                    aria-pressed={selectedKey === key}
                    draggable={isVisit && !editor?.locks[item.place.id]?.position}
                    onDragStart={(event) => {
                      event.dataTransfer.setData("text/x-travel-place", item.place.id);
                      event.dataTransfer.effectAllowed = "move";
                    }}
                    onClick={() => selectPlace(key)}
                  >
                    <span className="stop-time">{formatMinute(item.startMinute)}</span>
                    <span>
                      <strong>
                        {isVisit ? "" : item.purpose === "lunch" ? "午餐 · " : "晚餐 · "}
                        {item.place.name}
                      </strong>
                      <small>停留 {item.stayMinutes} 分钟（用户估算）</small>
                    </span>
                  </button>
                  {isVisit && (
                    <div
                      className="stop-actions"
                      role="group"
                      aria-label={`调整${item.place.name}`}
                    >
                      <button
                        id={`edit-stop-${item.place.id}`}
                        type="button"
                        className="button"
                        onClick={() => setEditing({ placeId: item.place.id })}
                      >
                        调整
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-pressed={!!editor?.locks[item.place.id]?.position}
                        onClick={() => toggleLock(item.place.id, "position")}
                      >
                        {editor?.locks[item.place.id]?.position ? "位置已锁" : "锁定位置"}
                      </button>
                      <button
                        type="button"
                        className="button"
                        aria-pressed={!!editor?.locks[item.place.id]?.time}
                        disabled={
                          item.startMinute === null && !editor?.locks[item.place.id]?.time
                        }
                        onClick={() => toggleLock(item.place.id, "time")}
                      >
                        {editor?.locks[item.place.id]?.time ? "时间已锁" : "锁定时间"}
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
          {[...new Set(day.issues)].map((issue) => (
            <p className="notice warning" key={issue} role="status">
              {issue}
            </p>
          ))}
          {editor && <MealPanel key={day.date} state={editor} dayIndex={ui.dayIndex} />}
          <p className="small muted">{draft.notices[1]}</p>
        </section>
        <section className="panel map-panel">
          <div>
            <h2>当天路线</h2>
            <p className="small muted">点击地图上的编号，查看地点详情。</p>
          </div>
          {wideScreen || ui.mobileTab === "map" ? (
            <RouteMap
              day={day}
              selectedId={selectedKey}
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
          {selected ? (
            <PlaceDetails place={selected} meal={selectedMeal} />
          ) : (
            <p>选择一个地点查看详情。</p>
          )}
        </aside>
      </div>
      {editor && <IntercityPanel state={editor} />}
      {day.items[0] && (
        <WeatherPanel
          key={`${day.date}:${day.items[0].place.id}:${day.items[0].place.location.join(",")}`}
          date={day.date}
          place={day.items[0].place}
        />
      )}
      {editor && <BudgetPanel state={editor} />}
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
        {selected && <PlaceDetails place={selected} meal={selectedMeal} />}
      </dialog>
      {editing && editor && (
        <EditDialog
          state={editor}
          placeId={editing.placeId}
          initialIndex={editing.initialIndex}
          onClose={() => setEditing(null)}
        />
      )}
      <footer className="workspace-footer">
        <span>当前行程仅保留在此页面，刷新后清空。</span>
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
    onSuccess: (draft) => {
      useDraftEditor.getState().start(draft);
      resetUi();
    },
  });
  function newPlan() {
    if (mutation.data && !window.confirm("当前草稿未保存，确定清空并新建计划吗？")) {
      return;
    }
    mutation.reset();
    useDraftEditor.getState().reset();
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
              <p>选择目的地和想去的地方，安排每天的行程。</p>
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
