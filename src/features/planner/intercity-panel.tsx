"use client";
import { Dialog } from "@/components/arc/dialog/dialog";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { z } from "zod";
import type { Draft } from "@/domain/models";
import { deriveMealTrip } from "@/domain/meals";
import {
  evaluateIntercity,
  type IntercityRole,
  type IntercitySetup,
} from "@/domain/intercity";
import {
  previewIntercity,
  type EditState,
  type IntercityProposal,
} from "@/domain/editing";
import { useDraftEditor } from "./editor-store";
import {
  buildIntercityForm,
  initialIntercityForm,
  roleLabels,
  type IntercityFields,
} from "./intercity-form";

const time = (value: string) =>
  new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
const money = (fen: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    fen / 100,
  );

export function IntercityView({ draft, setup }: { draft: Draft; setup: IntercitySetup }) {
  const report = evaluateIntercity(draft, setup.segments, setup.connections);
  return (
    <div className="intercity-view">
      {!setup.segments.length && (
        <p className="notice spacing">尚未录入跨城班次，到达与返程时间未校验。</p>
      )}
      {setup.segments.map((segment) => {
        const saved = setup.connections[segment.role];
        const stop =
          segment.role === "arrival"
            ? draft.days[0]?.items[0]
            : draft.days.at(-1)?.items.at(-1);
        const matches =
          stop &&
          saved &&
          (segment.role === "arrival"
            ? saved.fromId === segment.destination.id && saved.toId === stop.place.id
            : saved.fromId === stop.place.id && saved.toId === segment.origin.id);
        const connection = matches ? saved : null;
        const check = report.checks.find((item) => item.role === segment.role);
        return (
          <div className="intercity-item spacing" key={segment.id}>
            <h4>
              {roleLabels[segment.role]} · {segment.mode === "rail" ? "铁路" : "航班"}{" "}
              {segment.serviceNumber ?? "班次号未知"}
            </h4>
            <p>
              {segment.origin.name} → {segment.destination.name}
            </p>
            <p>
              {time(segment.departureAt)} 出发 → {time(segment.arrivalAt)} 到达
            </p>
            <p className="small muted">
              {segment.role === "arrival" ? "出站" : "进站"}缓冲：
              {segment.terminalBufferMinutes === null
                ? "未知"
                : `${segment.terminalBufferMinutes} 分钟`}
              ； 接驳：
              {connection?.seconds == null
                ? "未知"
                : `${connection.source.kind === "user" ? "手动估算" : "路线结果"} ${Math.ceil(connection.seconds / 60)} 分钟`}
              。
            </p>
            <p className="small muted">
              {segment.farePerPersonFen === null
                ? "票价估算未知，不代表免费"
                : `票价手动估算 ${money(segment.farePerPersonFen)} / 人`}
              ；站点位置与班次未核实。
            </p>
            <p
              className={`notice spacing ${check?.state === "conflict" ? "warning" : ""}`}
            >
              {check?.message}
            </p>
            {check?.slackSeconds != null && (
              <p className="small muted">
                按录入估算{check.slackSeconds < 0 ? "短缺" : "余量"}{" "}
                {Math.ceil(Math.abs(check.slackSeconds) / 60)} 分钟。
              </p>
            )}
            <p className="small muted">
              用户录入 {time(segment.source.recordedAt)} · Asia/Shanghai
            </p>
          </div>
        );
      })}
      {setup.segments.length > 0 && (
        <>
          {report.checks
            .filter((check) => check.segmentId === null)
            .map((check) => (
              <p key={check.role} className="small muted spacing">
                {check.message}
              </p>
            ))}
          {report.notices.map((notice) => (
            <p key={notice} className="small muted spacing">
              {notice}
            </p>
          ))}
        </>
      )}
    </div>
  );
}

const inputs: {
  key: Exclude<keyof IntercityFields, "enabled" | "mode">;
  label: string;
  type?: string;
  inputMode?: "numeric" | "decimal";
}[] = [
  { key: "number", label: "班次号（选填，不填订单号）" },
  { key: "origin", label: "出发站／机场" },
  { key: "destination", label: "到达站／机场" },
  { key: "departure", label: "出发日期时间", type: "datetime-local" },
  { key: "arrival", label: "到达日期时间", type: "datetime-local" },
  { key: "buffer", label: "进出站缓冲（分钟）", inputMode: "numeric" },
  { key: "transfer", label: "接驳总耗时（分钟）", inputMode: "numeric" },
  { key: "fare", label: "每人票价估算（元）", inputMode: "decimal" },
];

function IntercityDialog({ state, onClose }: { state: EditState; onClose: () => void }) {
  const [base] = useState(state);
  const [values, setValues] = useState(() => initialIntercityForm(state));
  const [proposal, setProposal] = useState<IntercityProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element) {
      element.scrollTop = 0;
      element
        .querySelector<HTMLHeadingElement>("#intercity-dialog-title")
        ?.focus({ preventScroll: true });
    }
  }, [proposal]);
  function close() {
    dialog.current?.close();
    onClose();
  }
  function update(role: IntercityRole, change: Partial<IntercityFields>) {
    setValues((current) => ({ ...current, [role]: { ...current[role], ...change } }));
  }
  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const current = useDraftEditor.getState().current;
      if (
        !current ||
        current.sessionId !== base.sessionId ||
        current.version !== base.version
      ) {
        throw new Error("行程已变化，请重新打开跨城安排。");
      }
      const setup = buildIntercityForm(base, values, new Date().toISOString());
      setProposal(previewIntercity(current, setup));
      setAcknowledged(false);
    } catch (cause) {
      setError(
        cause instanceof z.ZodError
          ? "请核对班次、起终站和完整日期；每程票价估算最多十万元。"
          : cause instanceof Error
            ? cause.message
            : "未能预览跨城安排。",
      );
    }
  }
  function confirm() {
    if (!proposal || (proposal.report.status === "infeasible" && !acknowledged)) {
      return;
    }
    try {
      useDraftEditor.getState().confirmIntercity(proposal, acknowledged);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未能确认跨城安排。");
    }
  }
  return (
    <Dialog
      ref={dialog}
      onClose={onClose}
      className="details-dialog edit-dialog"
      aria-labelledby="intercity-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="intercity-dialog-title" tabIndex={-1}>
          跨城安排
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭跨城安排"
          onClick={close}
        >
          <X size={20} />
        </button>
      </div>
      <p className="small muted spacing">
        国内铁路／航班人工记录，按上海时区填写完整出发与到达日期。不是订票或实时班次查询。
      </p>
      {!proposal ? (
        <form onSubmit={preview} noValidate>
          {(["arrival", "return"] as const).map((role) => (
            <fieldset className="intercity-group" key={role}>
              <legend>{roleLabels[role]}班次</legend>
              <label className="budget-toggle">
                <input
                  type="checkbox"
                  checked={values[role].enabled}
                  onChange={(event) => update(role, { enabled: event.target.checked })}
                />
                录入{roleLabels[role]}班次
              </label>
              {values[role].enabled && (
                <>
                  <div className="field-grid">
                    <div className="field">
                      <label htmlFor={`${role}-mode`}>{roleLabels[role]}交通方式</label>
                      <select
                        id={`${role}-mode`}
                        value={values[role].mode}
                        onChange={(event) =>
                          update(role, {
                            mode: event.target.value === "flight" ? "flight" : "rail",
                          })
                        }
                      >
                        <option value="rail">铁路</option>
                        <option value="flight">航班</option>
                      </select>
                    </div>
                    {inputs.map((input) => (
                      <div className="field" key={input.key}>
                        <label htmlFor={`${role}-${input.key}`}>
                          {roleLabels[role]}
                          {input.label}
                        </label>
                        <input
                          id={`${role}-${input.key}`}
                          type={input.type ?? "text"}
                          inputMode={input.inputMode}
                          value={values[role][input.key]}
                          onChange={(event) =>
                            update(role, { [input.key]: event.target.value })
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <p className="small muted spacing">
                    {role === "arrival" ? "到达站 → 首个活动" : "末个活动 → 返程出发站"}
                    的接驳总耗时，含等车；不重复加等待。缓冲／接驳／票价留空为未知，0
                    为明确估算，不代表免费。
                  </p>
                </>
              )}
            </fieldset>
          ))}
          <p className="notice spacing">
            票价不会自动替换旅行预算，防止重复计入；需要时另在跨城往返费用中明确填写。取消勾选并确认会移除对应记录。
          </p>
          <button type="submit" className="button primary spacing">
            预览跨城安排
          </button>
        </form>
      ) : (
        <section className="spacing" aria-label="跨城修改预览">
          <h3>跨城修改预览</h3>
          <div className="edit-comparison spacing">
            <div>
              <h3>当前记录</h3>
              <IntercityView
                draft={deriveMealTrip(base.draft, base.locks, base.meals).draft}
                setup={base.intercity}
              />
            </div>
            <div>
              <h3>确认后记录</h3>
              <IntercityView
                draft={deriveMealTrip(base.draft, base.locks, base.meals).draft}
                setup={proposal.setup}
              />
            </div>
          </div>
          <p className="notice spacing">
            只记录跨城事实与估算，不改变景点顺序、锁定或费用；后续行程编辑会复验这些到达／返程约束。
          </p>
          {proposal.report.status === "infeasible" && (
            <label className="budget-toggle">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              我知道时间冲突，仅记录含冲突的草稿
            </label>
          )}
          <div className="edit-actions">
            <button
              type="button"
              className="button"
              onClick={() => {
                setProposal(null);
                setError(null);
              }}
            >
              返回填写
            </button>
            <button
              type="button"
              className="button primary"
              disabled={proposal.report.status === "infeasible" && !acknowledged}
              onClick={confirm}
            >
              确认跨城安排
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="notice danger spacing" role="alert" aria-label="跨城录入失败">
          {error}
        </p>
      )}
    </Dialog>
  );
}

export function IntercityPanel({ state }: { state: EditState }) {
  const [open, setOpen] = useState(false);
  return (
    <section className="panel intercity-panel" aria-label="跨城安排">
      <div className="itinerary-heading">
        <div>
          <h2>跨城安排</h2>
          <p className="small muted">到达与返程人工记录 · 完整日期 · Asia/Shanghai</p>
        </div>
        <button type="button" className="button" onClick={() => setOpen(true)}>
          填写跨城安排
        </button>
      </div>
      <div className="saved-intercity">
        <IntercityView
          draft={deriveMealTrip(state.draft, state.locks, state.meals).draft}
          setup={state.intercity}
        />
      </div>
      {open && <IntercityDialog state={state} onClose={() => setOpen(false)} />}
    </section>
  );
}
