import type { Itinerary } from "@/domain/itinerary";
import { budgetCategories } from "@/domain/budget";
import {
  emptyItineraryExpenses,
  expenseIncluded,
  summarizeItineraryExpenses,
} from "@/domain/itinerary-expenses";

export const expenseLabels = {
  intercity: "跨城往返",
  local: "市内交通",
  lodging: "住宿",
  meals: "餐饮",
  tickets: "门票",
};
export const expenseMoney = (fen: number) =>
  new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(
    fen / 100,
  );
export function ItineraryExpenseSummary({ plan }: { plan: Itinerary }) {
  const expenses = plan.expenses ?? emptyItineraryExpenses();
  const summary = summarizeItineraryExpenses(plan.brief, expenses);
  const recorded = budgetCategories.some(
    (category) =>
      expenseIncluded(plan.brief, category) &&
      expenses.items[category].amountFen !== null,
  );
  return (
    <section className="trip-expense-summary" aria-label="全程手动费用估算">
      <h3>全程手动费用估算</h3>
      <p>
        {recorded
          ? `${summary.complete ? "手动估算合计" : "已知部分手动估算"} ${expenseMoney(summary.knownTotalFen)}（全体）`
          : "纳入目标的费用尚未录入，实际支出未知。"}
      </p>
      {summary.status === "over" && (
        <p className="trip-conflict">
          已知估算超过预算目标{" "}
          {expenseMoney(summary.knownTotalFen - summary.targetTotalFen)}
          ，不会自动增加预算。
        </p>
      )}
      {summary.missing.length > 0 && (
        <p>
          仍未知：{summary.missing.map((category) => expenseLabels[category]).join("、")}
          。已知部分不代表全程总费用。
        </p>
      )}
      {summary.status === "within_estimate" && (
        <p>所填估算未超目标；不是实时报价，也不证明预算充足。</p>
      )}
      <dl>
        {budgetCategories.map((category) => (
          <div key={category}>
            <dt>{expenseLabels[category]}</dt>
            <dd>
              {!expenseIncluded(plan.brief, category)
                ? "目标口径未计入"
                : summary.categoryTotals[category] === null
                  ? "未知"
                  : expenseMoney(summary.categoryTotals[category])}
            </dd>
          </div>
        ))}
      </dl>
      <p>
        所有金额均为全程手动估算；明确零元不代表免费，不含购物。每日实际费用未核实，不按目标均分替代。
      </p>
      {budgetCategories.some((category) => expenses.items[category].source !== null) && (
        <details>
          <summary>估算来源与记录时间</summary>
          {budgetCategories
            .filter((category) => expenses.items[category].source !== null)
            .map((category) => (
              <p key={category}>
                {expenseLabels[category]} · 用户记录（UTC）：
                {expenses.items[category].source?.recordedAt}
              </p>
            ))}
        </details>
      )}
    </section>
  );
}
export function ItineraryExpenseComparison({
  before,
  after,
}: {
  before: Itinerary;
  after: Itinerary;
}) {
  const previous = before.expenses ?? emptyItineraryExpenses();
  const next = after.expenses ?? emptyItineraryExpenses();
  const describe = (entry: typeof previous.items.intercity) =>
    entry.amountFen === null
      ? "未知"
      : `${expenseMoney(entry.amountFen)}／${entry.basis === "per_person" ? "人" : "全体"}`;
  return (
    <section className="trip-change-preview" aria-label="费用估算差异">
      <strong>全程手动费用记录 · 调整前 → 调整后</strong>
      <p>
        原方案 {before.brief.travelers} 人；新方案 {after.brief.travelers}{" "}
        人。目标口径以各自旅行需求为准，未知不是免费。
      </p>
      <dl>
        {budgetCategories.map((category) => (
          <div key={category}>
            <dt>{expenseLabels[category]}</dt>
            <dd>
              <span>{describe(previous.items[category])}</span>
              <span aria-label="调整为">→</span>
              <strong>{describe(next.items[category])}</strong>
            </dd>
          </div>
        ))}
      </dl>
      <ItineraryExpenseSummary plan={after} />
    </section>
  );
}
