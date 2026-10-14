"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import {
  budgetCategories,
  summarizeBudget,
  type BudgetCategory,
  type BudgetEstimate,
  type ExpenseEstimate,
} from "@/domain/budget";
import { previewBudget, type BudgetProposal, type EditState } from "@/domain/editing";
import { budgetEstimateSchema } from "@/lib/contracts";
import { parseYuanFen } from "@/lib/money";
import { useDraftEditor } from "./editor-store";

const labels: Record<BudgetCategory, string> = {
  intercity: "跨城往返",
  local: "市内交通",
  lodging: "住宿",
  meals: "餐饮",
  tickets: "门票",
};
const money = (fen: number) =>
  new Intl.NumberFormat("zh-CN", {
    style: "currency",
    currency: "CNY",
    maximumFractionDigits: 2,
  }).format(fen / 100);

function BudgetView({ estimate, state }: { estimate: BudgetEstimate; state: EditState }) {
  const summary = summarizeBudget(
    estimate,
    state.draft.input.travelers,
    state.draft.input.budgetPerPersonFen,
  );
  const filled = budgetCategories.filter(
    (category) => summary.categoryTotals[category] !== null,
  ).length;
  return (
    <div className="budget-view">
      <dl className="budget-facts">
        {budgetCategories.map((category) => (
          <div key={category}>
            <dt>{labels[category]}</dt>
            <dd>
              {category === "intercity" && !estimate.includeIntercity
                ? "未计入"
                : summary.categoryTotals[category] === null
                  ? "费用未知"
                  : money(summary.categoryTotals[category])}
            </dd>
          </div>
        ))}
      </dl>
      <p className="budget-number">
        {filled ? `已录入估算 ${money(summary.knownTotalFen)}` : "暂无费用估算"}
      </p>
      {filled > 0 && (
        <p className="small muted">
          人均已录入约 {money(summary.perPersonCeilingFen)}
          ；金额按人数均分，向上取整到分。
        </p>
      )}
      {summary.status === "over" ? (
        <p className="notice warning">
          已录入费用估算超出总预算目标{" "}
          {money(summary.knownTotalFen - summary.targetTotalFen)}。
        </p>
      ) : summary.status === "within_estimate" ? (
        <p className="notice">按已录入估算未超目标，实际费用仍待确认。</p>
      ) : (
        <p className="notice">还有未知费用，不能确认预算是否充足。</p>
      )}
      {summary.missing.length > 0 && (
        <p className="small muted">
          待估算：{summary.missing.map((category) => labels[category]).join("、")}。
        </p>
      )}
      {!estimate.includeIntercity && (
        <p className="small muted">当前预算范围不包含跨城往返。</p>
      )}
      <p className="small muted">费用为你手动填写的全程估算，非实时价格；不含购物。</p>
    </div>
  );
}

function BudgetDialog({ state, onClose }: { state: EditState; onClose: () => void }) {
  const [values, setValues] = useState(
    () =>
      Object.fromEntries(
        budgetCategories.map((category) => [
          category,
          {
            amount:
              state.budget.items[category].amountFen === null
                ? ""
                : (state.budget.items[category].amountFen / 100).toFixed(2),
            basis: state.budget.items[category].basis,
          },
        ]),
      ) as Record<BudgetCategory, { amount: string; basis: ExpenseEstimate["basis"] }>,
  );
  const [includeIntercity, setIncludeIntercity] = useState(state.budget.includeIntercity);
  const [proposal, setProposal] = useState<BudgetProposal | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  useEffect(() => {
    const element = dialog.current;
    if (element) {
      element.scrollTop = 0;
      element
        .querySelector<HTMLHeadingElement>("#budget-dialog-title")
        ?.focus({ preventScroll: true });
    }
  }, [proposal]);
  const summary = proposal
    ? summarizeBudget(
        proposal.budget,
        state.draft.input.travelers,
        state.draft.input.budgetPerPersonFen,
      )
    : null;

  function close() {
    dialog.current?.close();
    onClose();
  }

  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const current = useDraftEditor.getState().current;
      if (!current || current.sessionId !== state.sessionId) {
        throw new Error("当前行程已变化，请重新打开费用估算。");
      }
      const items = Object.fromEntries(
        budgetCategories.map((category) => {
          const raw = values[category].amount.trim();
          const amountFen = raw ? parseYuanFen(raw) : null;
          if (raw && amountFen === null) {
            throw new Error(
              `${labels[category]}金额无效，请填写非负金额，最多两位小数。`,
            );
          }
          const previous = current.budget.items[category];
          const unchanged =
            previous.amountFen === amountFen && previous.basis === values[category].basis;
          return [
            category,
            {
              amountFen,
              basis: values[category].basis,
              source:
                amountFen === null
                  ? null
                  : unchanged
                    ? previous.source
                    : { kind: "user", recordedAt: new Date().toISOString() },
            },
          ];
        }),
      );
      const parsed = budgetEstimateSchema.safeParse({ includeIntercity, items });
      if (!parsed.success) {
        throw new Error("费用信息无效，每项最多十万元，请检查金额与口径。");
      }
      setProposal(previewBudget(current, parsed.data));
      setAcknowledged(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "未能预览费用。");
    }
  }

  function confirm() {
    if (!proposal || (summary?.status === "over" && !acknowledged)) {
      return;
    }
    try {
      useDraftEditor.getState().confirmBudget(proposal);
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "费用未改变。");
    }
  }

  return (
    <dialog
      ref={dialog}
      className="details-dialog edit-dialog"
      aria-labelledby="budget-dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <div className="dialog-heading">
        <h2 id="budget-dialog-title" tabIndex={-1}>
          费用估算
        </h2>
        <button
          type="button"
          className="icon-button"
          aria-label="关闭费用估算"
          onClick={close}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <p className="small muted spacing">
        填写本次旅行的全程费用，留空表示未知；明确填 0 才作为零元估算。
      </p>
      {!proposal ? (
        <form noValidate onSubmit={preview}>
          <label className="budget-toggle">
            <input
              type="checkbox"
              checked={includeIntercity}
              onChange={(event) => setIncludeIntercity(event.target.checked)}
            />
            计入跨城往返
          </label>
          <div className="budget-inputs">
            {budgetCategories.map((category) => (
              <div key={category} className="field-grid">
                <div className="field">
                  <label htmlFor={`cost-${category}`}>{labels[category]}估算（元）</label>
                  <input
                    id={`cost-${category}`}
                    type="text"
                    inputMode="decimal"
                    value={values[category].amount}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        [category]: { ...values[category], amount: event.target.value },
                      })
                    }
                  />
                </div>
                <div className="field">
                  <label htmlFor={`basis-${category}`}>{labels[category]}口径</label>
                  <select
                    id={`basis-${category}`}
                    value={values[category].basis}
                    onChange={(event) =>
                      setValues({
                        ...values,
                        [category]: {
                          ...values[category],
                          basis: event.target.value as ExpenseEstimate["basis"],
                        },
                      })
                    }
                  >
                    <option value="per_person">每人全程</option>
                    <option value="trip">全体合计</option>
                  </select>
                </div>
              </div>
            ))}
          </div>
          <div className="form-actions">
            <small>每项最多十万元。</small>
            <button type="submit" className="button primary">
              预览费用
            </button>
          </div>
        </form>
      ) : (
        <section aria-label="费用修改预览">
          <p className="small muted spacing">确认前，已记录的费用保持不变。</p>
          <div className="edit-comparison">
            <div>
              <h3>当前估算</h3>
              <BudgetView estimate={state.budget} state={state} />
            </div>
            <div>
              <h3>调整后估算</h3>
              <BudgetView estimate={proposal.budget} state={state} />
            </div>
          </div>
          {summary?.status === "over" && (
            <label className="budget-toggle">
              <input
                type="checkbox"
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              我知道费用估算已超预算目标
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
              disabled={summary?.status === "over" && !acknowledged}
              onClick={confirm}
            >
              确认费用
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="notice danger" role="alert" aria-label="费用填写失败">
          {error}
        </p>
      )}
    </dialog>
  );
}

export function BudgetPanel({ state }: { state: EditState }) {
  const [open, setOpen] = useState(false);
  const totalTarget = state.draft.input.travelers * state.draft.input.budgetPerPersonFen;
  return (
    <section className="panel budget-panel" aria-label="旅行预算">
      <div className="itinerary-heading">
        <div>
          <h2>旅行预算</h2>
          <p className="small muted">
            目标 {money(state.draft.input.budgetPerPersonFen)} / 人，全体{" "}
            {money(totalTarget)}。
          </p>
        </div>
        <button type="button" className="button" onClick={() => setOpen(true)}>
          填写费用
        </button>
      </div>
      <div className="saved-budget">
        <BudgetView estimate={state.budget} state={state} />
      </div>
      {open && <BudgetDialog state={state} onClose={() => setOpen(false)} />}
    </section>
  );
}
