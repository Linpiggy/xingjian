"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import type { Itinerary } from "@/domain/itinerary";
import type { ItineraryChange } from "@/domain/itinerary-editing";
import { budgetCategories } from "@/domain/budget";
import { emptyItineraryExpenses, expenseIncluded } from "@/domain/itinerary-expenses";
import { itineraryExpensesSchema } from "@/lib/itinerary-contracts";
import { parseYuanFen } from "@/lib/money";
import { expenseLabels } from "./itinerary-expense-view";

export function ItineraryExpenseDialog({
  plan,
  onClose,
  onPropose,
}: {
  plan: Itinerary;
  onClose: () => void;
  onPropose: (change: ItineraryChange) => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const skipRestore = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const previous = plan.expenses ?? emptyItineraryExpenses();
  useEffect(() => {
    const dialog = ref.current;
    const trigger = document.activeElement;
    if (!dialog) {
      return;
    }
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialog.showModal();
    dialog.querySelector<HTMLElement>("h2")?.focus();
    return () => {
      dialog.close();
      document.body.style.overflow = overflow;
      if (!skipRestore.current && trigger instanceof HTMLElement && trigger.isConnected) {
        trigger.focus({ preventScroll: true });
      }
    };
  }, []);
  function preview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    try {
      const data = new FormData(event.currentTarget);
      const expenses = emptyItineraryExpenses();
      const recordedAt = new Date().toISOString();
      for (const category of budgetCategories) {
        const raw = String(data.get(`${category}-amount`) ?? "").trim();
        const amountFen = raw ? parseYuanFen(raw) : null;
        const basis = data.get(`${category}-basis`);
        if (
          (raw && amountFen === null) ||
          (amountFen !== null && amountFen > 10_000_000) ||
          (basis !== "per_person" && basis !== "trip")
        ) {
          throw new Error(
            `${expenseLabels[category]}须为不超过十万元的非负金额，最多两位小数，并明确口径。`,
          );
        }
        expenses.items[category] = {
          amountFen,
          basis,
          source: amountFen === null ? null : { kind: "user", recordedAt },
        };
      }
      skipRestore.current = true;
      onPropose({
        kind: "expenses",
        expenses: itineraryExpensesSchema.parse(expenses),
        acknowledgeOver: data.get("acknowledgeOver") === "on",
      });
      ref.current?.close();
    } catch (cause) {
      skipRestore.current = false;
      setError(cause instanceof Error ? cause.message : "费用未应用，请重试。");
    }
  }
  return (
    <dialog
      ref={ref}
      className="trip-expense-dialog"
      aria-labelledby="trip-expense-title"
      onClose={() => {
        if (!ref.current?.open) {
          onClose();
        }
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) {
          return;
        }
        const box = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < box.left ||
          event.clientX > box.right ||
          event.clientY < box.top ||
          event.clientY > box.bottom
        ) {
          event.currentTarget.close();
        }
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) {
          return;
        }
        const controls = event.currentTarget.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
        );
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        } else if (
          event.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === event.currentTarget.querySelector("h2"))
        ) {
          event.preventDefault();
          last?.focus();
        }
      }}
    >
      <header>
        <div>
          <span>手动估算 · 人民币</span>
          <h2 id="trip-expense-title" tabIndex={-1}>
            补齐全程费用参考
          </h2>
        </div>
        <button
          type="button"
          className="trip-detail-close"
          aria-label="关闭费用估算"
          onClick={() => ref.current?.close()}
        >
          <X size={18} aria-hidden="true" />
        </button>
      </header>
      <form onSubmit={preview} noValidate onInput={() => setError(null)}>
        <p>
          每项填写整个行程的金额，不自动乘天数。按 {plan.brief.travelers}{" "}
          人换算全体总额；留空未知，明确零元仅为手工估算，不代表免费或实时报价。
        </p>
        <div className="trip-expense-fields">
          {budgetCategories.map((category) => (
            <fieldset key={category}>
              <legend>
                {expenseLabels[category]}
                {!expenseIncluded(plan.brief, category) && " · 当前目标口径未计入"}
              </legend>
              <label htmlFor={`expense-${category}`}>
                全程{expenseLabels[category]}费用（元）
              </label>
              <input
                id={`expense-${category}`}
                name={`${category}-amount`}
                inputMode="decimal"
                placeholder="留空为未知"
                defaultValue={
                  previous.items[category].amountFen === null
                    ? ""
                    : (previous.items[category].amountFen / 100).toFixed(2)
                }
              />
              <label htmlFor={`expense-${category}-basis`}>
                {expenseLabels[category]}金额口径
              </label>
              <select
                id={`expense-${category}-basis`}
                name={`${category}-basis`}
                defaultValue={previous.items[category].basis}
              >
                <option value="per_person">每位同行者，全程</option>
                <option value="trip">全部同行者合计，全程</option>
              </select>
            </fieldset>
          ))}
        </div>
        <label className="trip-expense-ack">
          <input type="checkbox" name="acknowledgeOver" />
          我已知晓已填估算可能超过预算目标，仍按此记录；不自动增加预算
        </label>
        {error && (
          <p role="alert" className="trip-error">
            {error}
          </p>
        )}
        <footer>
          <button type="submit" className="button primary">
            预览费用估算
          </button>
          <button type="button" className="button" onClick={() => ref.current?.close()}>
            暂不修改费用
          </button>
        </footer>
      </form>
    </dialog>
  );
}
