"use client";

import { useState } from "react";
import type { MealEntry } from "@/domain/meals";
import { formatMinute } from "@/domain/draft";
import { mealLabels } from "./meal-form";
import type { VenueFields } from "./venue-form";

const reservationLabels = {
  unknown: "未知，尚未核对",
  not_required: "用户记录无需预约",
  required_unconfirmed: "需要预约，尚未取得",
  confirmed: "用户记录已预约，非平台核验",
};
export function VenueRulesFields({
  kind,
  fields,
  hasPlace,
  hadConfirmed,
  onChange,
}: {
  kind: "lunch" | "dinner";
  fields: VenueFields;
  hasPlace: boolean;
  hadConfirmed: boolean;
  onChange: (value: VenueFields) => void;
}) {
  const [open, setOpen] = useState(fields.enabled || hadConfirmed);
  const label = mealLabels[kind];
  const patch = (change: Partial<VenueFields>) => {
    const reservationChanged = [
      "enabled",
      "date",
      "reservation",
      "entryStart",
      "entryEnd",
    ].some((key) => Object.hasOwn(change, key));
    onChange({
      ...fields,
      ...change,
      ...(reservationChanged ? { releaseConfirmed: false } : {}),
    });
  };
  function input(
    key: "date" | "lastEntry" | "entryStart" | "entryEnd",
    title: string,
    type = "datetime-local",
  ) {
    return (
      <div className="field">
        <label htmlFor={`${kind}-venue-${key}`}>
          {label}
          {title}
        </label>
        <input
          id={`${kind}-venue-${key}`}
          type={type}
          value={fields[key]}
          onChange={(event) => patch({ [key]: event.target.value })}
        />
      </div>
    );
  }
  return (
    <div className="spacing">
      <button
        type="button"
        className="button"
        aria-expanded={open}
        aria-controls={`${kind}-venue-fields`}
        disabled={!hasPlace}
        onClick={() => setOpen(!open)}
      >
        {open ? "收起" : "填写"}
        {label}营业与预约
      </button>
      <div id={`${kind}-venue-fields`}>
        {open && (
          <>
            <p className="small muted spacing">
              仅记录你核对的当天规则，非商家实时保证；预约不代办、不自动取消，过敏安全仍需向商家确认。
            </p>
            <label className="budget-toggle">
              <input
                type="checkbox"
                checked={fields.enabled}
                onChange={(event) => patch({ enabled: event.target.checked })}
              />
              录入{label}营业与预约
            </label>
            {fields.enabled && (
              <>
                <div className="field-grid">
                  {input("date", "规则适用日期", "date")}
                  <div className="field">
                    <label htmlFor={`${kind}-opening`}>{label}营业状态</label>
                    <select
                      id={`${kind}-opening`}
                      value={fields.opening}
                      onChange={(event) => {
                        const value = event.target.value;
                        if (
                          value === "unknown" ||
                          value === "closed" ||
                          value === "windows"
                        ) {
                          patch({ opening: value });
                        }
                      }}
                    >
                      <option value="unknown">未知，不推断营业</option>
                      <option value="closed">当天闭店</option>
                      <option value="windows">用户录入营业时段</option>
                    </select>
                  </div>
                  {input("lastEntry", "最晚入场（选填）")}
                  <div className="field">
                    <label htmlFor={`${kind}-reservation`}>{label}预约状态</label>
                    <select
                      id={`${kind}-reservation`}
                      value={fields.reservation}
                      onChange={(event) => {
                        const value = (
                          Object.keys(
                            reservationLabels,
                          ) as (keyof typeof reservationLabels)[]
                        ).find((key) => key === event.target.value);
                        if (value) {
                          patch({ reservation: value });
                        }
                      }}
                    >
                      {Object.entries(reservationLabels).map(([value, text]) => (
                        <option key={value} value={value}>
                          {text}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                {fields.opening === "windows" && (
                  <section aria-label={`${label}营业时段`} className="spacing">
                    {fields.windows.map((window, index) => (
                      <div key={index} className="spacing">
                        <div className="field-grid">
                          {(["start", "end"] as const).map((key) => (
                            <div className="field" key={key}>
                              <label htmlFor={`${kind}-opening-${index}-${key}`}>
                                {label}营业时段 {index + 1}{" "}
                                {key === "start" ? "开始" : "结束"}
                              </label>
                              <input
                                id={`${kind}-opening-${index}-${key}`}
                                type="datetime-local"
                                value={window[key]}
                                onChange={(event) =>
                                  patch({
                                    windows: fields.windows.map((item, itemIndex) =>
                                      itemIndex === index
                                        ? { ...item, [key]: event.target.value }
                                        : item,
                                    ),
                                  })
                                }
                              />
                            </div>
                          ))}
                        </div>
                        <button
                          type="button"
                          className="button"
                          onClick={() =>
                            patch({
                              windows: fields.windows.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            })
                          }
                        >
                          删除{label}营业时段 {index + 1}
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="button spacing"
                      disabled={fields.windows.length >= 8}
                      onClick={() =>
                        patch({ windows: [...fields.windows, { start: "", end: "" }] })
                      }
                    >
                      添加{label}营业时段
                    </button>
                    <p className="small muted">
                      最多八段；按完整上海日期填写，可跨午夜，整段停留须在营业覆盖内。
                    </p>
                  </section>
                )}
                {fields.reservation === "confirmed" && (
                  <div className="field-grid spacing">
                    {input("entryStart", "预约入场开始（选填）")}
                    {input("entryEnd", "预约入场结束（选填）")}
                  </div>
                )}
                <p className="small muted spacing">
                  最晚入场留空为未知；预约入场窗口结束不含该时刻，不限制离场时间。已预约但窗口未知时，两端均留空。
                </p>
              </>
            )}
          </>
        )}
      </div>
      {hadConfirmed && (
        <label className="budget-toggle spacing">
          <input
            type="checkbox"
            checked={fields.releaseConfirmed}
            onChange={(event) => patch({ releaseConfirmed: event.target.checked })}
          />
          我已核对{label}原预约变更／移除，知晓此操作不代为取消商家预约
        </label>
      )}
    </div>
  );
}

export function VenueFacts({ entries, label }: { entries: MealEntry[]; label: string }) {
  return (
    <section aria-label={label} className="spacing">
      {entries.map((entry) => (
        <div key={entry.id} className="spacing">
          <h4>{mealLabels[entry.kind]}营业／预约记录</h4>
          {!entry.rules ? (
            <p className="small muted">营业、最晚入场与预约未知。</p>
          ) : (
            <>
              <p className="small muted">
                适用日期：{entry.rules.date}；营业：
                {entry.rules.openingWindows === null
                  ? "未知"
                  : entry.rules.openingWindows.length === 0
                    ? "当天闭店"
                    : entry.rules.openingWindows
                        .map(
                          (window) =>
                            `${formatMinute(window.startMinute)}—${formatMinute(window.endMinute)}`,
                        )
                        .join("、")}
                ；最晚入场：
                {entry.rules.lastEntryMinute === null
                  ? "未知"
                  : formatMinute(entry.rules.lastEntryMinute)}
                。
              </p>
              <p className="small muted">
                预约：{reservationLabels[entry.rules.reservation.state]}；入场窗口：
                {entry.rules.reservation.entryWindow
                  ? `[${formatMinute(entry.rules.reservation.entryWindow.startMinute)}, ${formatMinute(entry.rules.reservation.entryWindow.endMinute)})`
                  : "未知／不适用"}
                。
              </p>
              <p className="small muted">
                用户记录（UTC）：{entry.rules.source.recordedAt}，非商家核验。
              </p>
            </>
          )}
        </div>
      ))}
    </section>
  );
}
