"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { z } from "zod";
import type { Draft, Place, WalkingRoute } from "@/domain/models";
import { formatMinute } from "@/domain/draft";
import { deriveMealTrip } from "@/domain/meals";
import { mealReservationReleases } from "@/domain/meal-reservations";
import {
  previewMeals,
  resolveMeals,
  type EditState,
  type MealProposal,
} from "@/domain/editing";
import { placesResponseSchema, walkingSchema } from "@/lib/contracts";
import { requestJson } from "@/lib/client-api";
import { useDraftEditor } from "./editor-store";
import {
  buildMealForm,
  initialMealForm,
  mealCostText,
  mealLabels,
  withoutMealDay,
  type MealFields,
} from "./meal-form";
import { IntercityView } from "./intercity-panel";
import { initialVenueFields } from "./venue-form";
import { VenueRulesFields, VenueFacts } from "./venue-rules-fields";

const routeResponse = z.object({ route: walkingSchema });
function RestaurantSearch({
  city,
  kind,
  selected,
  onChoose,
}: {
  city: string;
  kind: "lunch" | "dinner";
  selected: Place | null;
  onChoose: (place: Place) => void;
}) {
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const request = useRef<AbortController | null>(null);
  const label = mealLabels[kind];
  useEffect(() => () => request.current?.abort(), []);
  async function search() {
    request.current?.abort();
    if (!keyword.trim() || keyword.trim().length > 60) {
      setError("请输入 1—60 字的餐厅名称或关键词。");
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setResults(null);
    setError(null);
    try {
      const result = await requestJson(
        `/api/places?${new URLSearchParams({ city, keyword: keyword.trim() })}`,
        placesResponseSchema,
        { signal: controller.signal },
      );
      if (!controller.signal.aborted) {
        setResults(result.places);
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error ? cause.message : "餐厅搜索未成功，原选择保持不变。",
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setPending(false);
      }
    }
  }
  return (
    <section aria-label={`${label}餐厅选择`} className="meal-search">
      <div className="field">
        <label htmlFor={`${kind}-search`}>{label}餐厅关键词</label>
        <input
          id={`${kind}-search`}
          value={keyword}
          maxLength={60}
          onChange={(event) => {
            request.current?.abort();
            setPending(false);
            setResults(null);
            setError(null);
            setKeyword(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void search();
            }
          }}
        />
      </div>
      <button type="button" className="button" disabled={pending} onClick={search}>
        {pending ? "正在搜索" : `搜索${label}餐厅`}
      </button>
      <p className="small muted">
        {selected ? `已选：${selected.name}` : `尚未选择${label}餐厅。`} 搜索范围：{city}
        ；请核对地址与经营类型。
      </p>
      {pending && <p role="status">正在查询餐厅候选，未改变当前行程。</p>}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {results &&
        (results.length ? (
          <ul className="meal-candidates">
            {results.map((place) => (
              <li key={place.id}>
                <strong>{place.name}</strong>
                <p className="small muted">
                  {place.address ?? "地址未知"} ·{" "}
                  {place.source.kind === "fixture"
                    ? "测试 fixture，非实时"
                    : place.source.kind === "provider"
                      ? "高德地点查询"
                      : "用户记录"}
                </p>
                <button
                  type="button"
                  className="button"
                  onClick={() => {
                    onChoose(place);
                    setResults(null);
                  }}
                  aria-label={`${label}选择${place.name}`}
                >
                  选择此餐厅
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p role="status">没有找到餐厅，请修改关键词；不使用替代假数据。</p>
        ))}
    </section>
  );
}
function PreviewDay({ draft, date }: { draft: Draft; date: string }) {
  const day = draft.days.find((item) => item.date === date);
  return (
    <ol className="meal-preview-list">
      {day?.items.map((item, index) => (
        <li key={item.activityId ?? item.place.id}>
          <strong>
            {item.purpose === "lunch"
              ? "午餐 · "
              : item.purpose === "dinner"
                ? "晚餐 · "
                : ""}
            {item.place.name}
          </strong>
          <p>
            {formatMinute(item.startMinute)} — {formatMinute(item.endMinute)}
          </p>
          {index > 0 && (
            <p className="small muted">
              前段步行：
              {day.legs[index - 1]?.route?.seconds == null
                ? "耗时未知"
                : `${Math.ceil(day.legs[index - 1].route!.seconds! / 60)} 分钟`}
              ，另加 {draft.input.bufferMinutes} 分钟缓冲。
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
function MealDialog({
  state,
  dayIndex,
  onClose,
}: {
  state: EditState;
  dayIndex: number;
  onClose: () => void;
}) {
  const [base] = useState(state);
  const [form, setForm] = useState(() => initialMealForm(state, dayIndex));
  const [proposal, setProposal] = useState<MealProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const request = useRef<AbortController | null>(null);
  const routes = useRef<WalkingRoute[]>([]);
  const [resolvedCount, setResolvedCount] = useState(0);
  const date = base.draft.days[dayIndex].date;
  const before = deriveMealTrip(base.draft, base.locks, base.meals).draft;
  useEffect(() => {
    dialog.current?.showModal();
    return () => request.current?.abort();
  }, []);
  useEffect(() => {
    if (dialog.current) {
      dialog.current.scrollTop = 0;
      dialog.current
        .querySelector<HTMLElement>("#meal-dialog-title")
        ?.focus({ preventScroll: true });
    }
  }, [proposal]);
  function close() {
    request.current?.abort();
    dialog.current?.close();
    onClose();
  }
  function currentVersion() {
    const current = useDraftEditor.getState().current;
    if (
      !current ||
      current.sessionId !== base.sessionId ||
      current.version !== base.version
    ) {
      throw new Error("行程已变化，请重新打开用餐安排。");
    }
    return current;
  }
  function update(kind: "lunch" | "dinner", change: Partial<MealFields>) {
    setForm((value) => ({
      ...value,
      slots: { ...value.slots, [kind]: { ...value.slots[kind], ...change } },
    }));
    setError(null);
  }
  function preview(remove = false) {
    try {
      const current = currentVersion();
      const setup = remove
        ? withoutMealDay(
            base,
            dayIndex,
            base.meals.days
              .find((day) => day.date === date)
              ?.entries.every(
                (entry) =>
                  entry.rules?.reservation.state !== "confirmed" ||
                  form.slots[entry.kind].venue.releaseConfirmed,
              ) ?? false,
          )
        : buildMealForm(base, dayIndex, form, new Date().toISOString());
      routes.current = [];
      setResolvedCount(0);
      const releases = mealReservationReleases(base.meals, setup).filter((release) =>
        base.meals.days
          .find((day) => day.date === date)
          ?.entries.some(
            (entry) =>
              entry.id === release.activityId &&
              form.slots[entry.kind].venue.releaseConfirmed,
          ),
      );
      setProposal(previewMeals(current, setup, releases));
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? "请核对完整上海日期、用餐／营业／预约窗口、最晚入场及当天结束时间；各窗口起止须有效。"
          : cause instanceof Error
            ? cause.message
            : "未能预览用餐安排。",
      );
    }
  }
  async function query() {
    if (!proposal || pending) {
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setPending(true);
    setError(null);
    try {
      currentVersion();
      for (const gap of proposal.view.gaps.slice(routes.current.length)) {
        const result = await requestJson("/api/routes", routeResponse, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ origin: gap.origin, destination: gap.destination }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) {
          return;
        }
        routes.current.push(result.route);
        setResolvedCount(routes.current.length);
      }
      if (!controller.signal.aborted) {
        setProposal(resolveMeals(currentVersion(), proposal, routes.current));
      }
    } catch (cause) {
      if (!controller.signal.aborted) {
        setError(
          cause instanceof Error
            ? cause.message
            : "路线查询失败，保留已成功路段，请明确重试。",
        );
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
      currentVersion();
      useDraftEditor.getState().confirmMeals(proposal);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未能确认用餐安排。");
    }
  }
  return (
    <dialog
      ref={dialog}
      className="details-dialog edit-dialog meal-dialog"
      aria-labelledby="meal-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="meal-dialog-title" tabIndex={-1}>
          午晚餐安排
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭用餐安排"
          onClick={close}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="small muted spacing">
        {date} ·
        上海时区。手动选择餐厅与窗口，不确认营业、预约或过敏安全；时间和费用未知不按零计算。
      </p>
      {!proposal ? (
        <section aria-label="填写用餐安排">
          {(["lunch", "dinner"] as const).map((kind) => (
            <fieldset key={kind} className="meal-group">
              <legend>{mealLabels[kind]}</legend>
              <RestaurantSearch
                city={base.draft.input.city}
                kind={kind}
                selected={form.slots[kind].place}
                onChoose={(place) => {
                  const previous = form.slots[kind].place;
                  const changed =
                    previous?.id !== place.id ||
                    previous.location.some(
                      (value, index) => value !== place.location[index],
                    );
                  update(kind, {
                    place,
                    ...(changed
                      ? {
                          price: "",
                          dietary: "unknown",
                          venue: initialVenueFields(null, date, place),
                        }
                      : {}),
                  });
                }}
              />
              <div className="field-grid">
                <div className="field">
                  <label htmlFor={`${kind}-after`}>{mealLabels[kind]}插入位置</label>
                  <select
                    id={`${kind}-after`}
                    value={form.slots[kind].afterPlaceId}
                    onChange={(event) =>
                      update(kind, { afterPlaceId: event.target.value })
                    }
                  >
                    <option value="">当天首个活动之前</option>
                    {base.draft.days[dayIndex].items.map((item) => (
                      <option key={item.place.id} value={item.place.id}>
                        {item.place.name}之后
                      </option>
                    ))}
                  </select>
                </div>
                {(
                  [
                    { key: "stay", label: "停留分钟", type: "text" },
                    { key: "start", label: "最早用餐", type: "datetime-local" },
                    { key: "end", label: "最晚结束", type: "datetime-local" },
                    { key: "price", label: "每人餐费估算（元，选填）", type: "text" },
                  ] as const
                ).map((input) => (
                  <div className="field" key={input.key}>
                    <label htmlFor={`${kind}-${input.key}`}>
                      {mealLabels[kind]}
                      {input.label}
                    </label>
                    <input
                      id={`${kind}-${input.key}`}
                      type={input.type}
                      inputMode={
                        input.key === "price"
                          ? "decimal"
                          : input.key === "stay"
                            ? "numeric"
                            : undefined
                      }
                      value={form.slots[kind][input.key]}
                      onChange={(event) =>
                        update(kind, { [input.key]: event.target.value })
                      }
                    />
                  </div>
                ))}
                <div className="field">
                  <label htmlFor={`${kind}-diet`}>{mealLabels[kind]}饮食核对</label>
                  <select
                    id={`${kind}-diet`}
                    value={form.slots[kind].dietary}
                    onChange={(event) => {
                      const value = event.target.value;
                      if (
                        value === "unknown" ||
                        value === "user_checked" ||
                        value === "user_conflict"
                      ) {
                        update(kind, { dietary: value });
                      }
                    }}
                  >
                    <option value="unknown">未知，尚未核对</option>
                    <option value="user_checked">用户已核对，仍需向商家确认</option>
                    <option value="user_conflict">已知饮食冲突</option>
                  </select>
                </div>
              </div>
              <VenueRulesFields
                kind={kind}
                fields={form.slots[kind].venue}
                hasPlace={form.slots[kind].place !== null}
                hadConfirmed={
                  base.meals.days
                    .find((day) => day.date === date)
                    ?.entries.some(
                      (entry) =>
                        entry.kind === kind &&
                        entry.rules?.reservation.state === "confirmed",
                    ) ?? false
                }
                onChange={(venue) => update(kind, { venue })}
              />
              <p className="small muted spacing">
                费用留空为未知，明确 0
                也不代表免费；营业与预约未另行录入时保持未知，不解析商家描述作保证。
              </p>
            </fieldset>
          ))}
          <div className="field">
            <label htmlFor="meal-day-end">当天活动最晚结束（上海时间）</label>
            <input
              id="meal-day-end"
              type="datetime-local"
              value={form.end}
              onChange={(event) =>
                setForm((value) => ({ ...value, end: event.target.value }))
              }
            />
          </div>
          <div className="edit-actions">
            <button
              type="button"
              className="button"
              disabled={!base.meals.days.some((day) => day.date === date)}
              onClick={() => preview(true)}
            >
              预览移除当天餐次
            </button>
            <button type="button" className="button primary" onClick={() => preview()}>
              预览用餐安排
            </button>
          </div>
        </section>
      ) : (
        <section aria-label="用餐修改预览">
          <div className="edit-comparison">
            <div>
              <h3>当前安排</h3>
              <PreviewDay draft={before} date={date} />
              <VenueFacts
                entries={base.meals.days.find((day) => day.date === date)?.entries ?? []}
                label="当前营业预约"
              />
              <p>{mealCostText(base.meals, base.draft.input.dayCount)}</p>
            </div>
            <div>
              <h3>确认后安排</h3>
              <PreviewDay draft={proposal.view.draft} date={date} />
              <VenueFacts
                entries={
                  proposal.setup.days.find((day) => day.date === date)?.entries ?? []
                }
                label="调整后营业预约"
              />
              <p>{mealCostText(proposal.setup, base.draft.input.dayCount)}</p>
            </div>
          </div>
          <p className="notice spacing">
            以上只比较餐次人均已知估算，未计未知费用；全程五类预算不变，不自动加总或替换。明确零元不代表免费。
          </p>
          {base.intercity.segments.length > 0 && (
            <section aria-label="用餐后跨城校验" className="spacing">
              <h3>用餐后跨城校验</h3>
              <IntercityView draft={proposal.view.draft} setup={base.intercity} />
            </section>
          )}
          {proposal.view.plans.flatMap((plan) =>
            plan.issues
              .filter((issue) => issue.severity === "unknown")
              .map((issue, index) => (
                <p key={`${plan.date}:${index}`} className="small muted">
                  {issue.message}
                </p>
              )),
          )}
          {proposal.view.conflicts.map((message) => (
            <p key={message} className="notice warning" role="status">
              {message}
            </p>
          ))}
          {proposal.view.gaps.length > 0 && (
            <p className="notice spacing">
              需查询 {proposal.view.gaps.length}{" "}
              段实际相邻步行路线，可能消耗接口额度。已成功 {resolvedCount}{" "}
              段；失败后仅补查其余路段。
            </p>
          )}
          {pending && <p role="status">正在查询用餐接驳，当前行程保持不变。</p>}
          <div className="edit-actions">
            <button
              type="button"
              className="button"
              disabled={pending}
              onClick={() => {
                setProposal(null);
                routes.current = [];
                setResolvedCount(0);
                setError(null);
              }}
            >
              返回填写
            </button>
            {proposal.view.gaps.length ? (
              <button
                type="button"
                className="button primary"
                disabled={pending || proposal.view.conflicts.length > 0}
                onClick={query}
              >
                {pending ? "正在查询" : "查询用餐接驳"}
              </button>
            ) : (
              <button
                type="button"
                className="button primary"
                disabled={
                  pending ||
                  proposal.view.conflicts.length > 0 ||
                  proposal.view.draft.status === "infeasible"
                }
                onClick={confirm}
              >
                确认用餐安排
              </button>
            )}
          </div>
        </section>
      )}
      {error && (
        <p className="notice danger spacing" role="alert" aria-label="用餐修改失败">
          {error} 当前行程未改变。
        </p>
      )}
    </dialog>
  );
}
export function MealPanel({ state, dayIndex }: { state: EditState; dayIndex: number }) {
  const [open, setOpen] = useState(false);
  const setting = state.meals.days.find(
    (day) => day.date === state.draft.days[dayIndex].date,
  );
  return (
    <section className="incomplete meal-panel" aria-label="当天用餐安排">
      <h3>{setting ? "午晚餐已列入草稿" : "午餐与晚餐待安排"}</h3>
      <p className="small muted">
        餐厅选择、餐费、饮食与营业仍须核实；确认前不改变当前行程。
      </p>
      <button type="button" className="button spacing" onClick={() => setOpen(true)}>
        {setting ? "调整午晚餐" : "安排午晚餐"}
      </button>
      {open && (
        <MealDialog state={state} dayIndex={dayIndex} onClose={() => setOpen(false)} />
      )}
    </section>
  );
}
