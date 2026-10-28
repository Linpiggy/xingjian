import type { Itinerary } from "@/domain/itinerary";
import type { ItineraryChange } from "@/domain/itinerary-editing";
import { formatMinute } from "@/domain/draft";
import type { VenueRules } from "@/domain/meal-planning";
import { ItineraryExpenseComparison } from "./itinerary-expense-view";

export function ItineraryChangePreview({
  before,
  after,
  change,
}: {
  before: Itinerary;
  after: Itinerary;
  change: ItineraryChange;
}) {
  if (change.kind === "expenses") {
    return <ItineraryExpenseComparison before={before} after={after} />;
  }
  const locations = (plan: Itinerary) =>
    plan.days.flatMap((day, dayIndex) =>
      (day.schedule?.items ?? []).map((item, index) => ({
        item,
        date: day.date,
        dayIndex,
        index,
      })),
    );
  const original = locations(before);
  const candidate = locations(after);
  const target = original.find((value) => value.item.activity.id === change.activityId);
  const differences = candidate.filter(({ item, date, index }) => {
    const previous = original.find(
      (value) => value.item.activity.id === item.activity.id,
    );
    return (
      previous &&
      (previous.date !== date ||
        previous.index !== index ||
        previous.item.startMinute !== item.startMinute ||
        previous.item.endMinute !== item.endMinute ||
        previous.item.activity.stayMinutes !== item.activity.stayMinutes ||
        previous.item.activity.fixedStartMinute !== item.activity.fixedStartMinute ||
        Boolean(previous.item.activity.positionLocked) !==
          Boolean(item.activity.positionLocked) ||
        JSON.stringify(previous.item.activity.rules) !==
          JSON.stringify(item.activity.rules))
    );
  });
  let description: string;
  if (change.kind === "duration") {
    description = `建议停留 ${target?.item.activity.stayMinutes} → ${change.stayMinutes} 分钟`;
  } else if (change.kind === "move") {
    description = `第 ${(target?.dayIndex ?? 0) + 1} 天第 ${(target?.index ?? 0) + 1} 项 → 第 ${change.toDay + 1} 天第 ${change.toIndex + 1} 项`;
  } else if (change.kind === "venue_rules") {
    description = "更新用户营业／预约记录";
  } else if (change.kind === "position_lock") {
    description = change.locked ? "锁定此地点的日期与次序" : "明确解除地点位置锁";
  } else {
    description = change.locked ? "锁定当前估算开始时间" : "明确解除开始时间锁";
  }
  return (
    <section className="trip-change-preview" aria-label="活动修改差异">
      <strong>
        {target?.item.activity.place.name} · {description}
      </strong>
      <dl>
        {differences.map(({ item, date }) => {
          const previous = original.find(
            (value) => value.item.activity.id === item.activity.id,
          )!;
          return (
            <div key={item.activity.id}>
              <dt>{item.activity.place.name}</dt>
              <dd>
                <span>
                  {previous.date !== date && <small>{previous.date}</small>}
                  {formatMinute(previous.item.startMinute)}—
                  {formatMinute(previous.item.endMinute)}
                </span>
                <span aria-label="调整为">→</span>
                <strong>
                  {previous.date !== date && <small>{date}</small>}
                  {formatMinute(item.startMinute)}—{formatMinute(item.endMinute)}
                </strong>
              </dd>
            </div>
          );
        })}
      </dl>
      {change.kind === "venue_rules" && (
        <section className="trip-rules-comparison" aria-label="营业预约修改差异">
          <RuleFacts title="调整前规则" rules={target?.item.activity.rules ?? null} />
          <RuleFacts title="调整后规则" rules={change.rules} />
        </section>
      )}
      <p>
        {change.kind === "venue_rules"
          ? "仅为用户核对记录，非商家核验；预约变更核对不代办或取消商家预约。规则修改不改地点顺序、路线与预算目标。"
          : change.kind === "move"
            ? "顺序由你指定，仅补查变化的有向相邻路段；预算目标不自动变化，原推荐理由未重写。未知交通不视为零耗时。"
            : "预算目标、地点顺序与路线不变；位置锁不固定时刻，时间锁不代表商家预约。"}
      </p>
    </section>
  );
}

function RuleFacts({ title, rules }: { title: string; rules: VenueRules | null }) {
  const labels = {
    unknown: "未知",
    not_required: "用户记录无需预约",
    required_unconfirmed: "需预约，尚未取得",
    confirmed: "用户记录已预约，非平台核验",
  };
  return (
    <section>
      <h3>{title}</h3>
      {!rules ? (
        <p>营业与预约尚未核实。</p>
      ) : (
        <>
          <p>
            适用日期：{rules.date}；营业：
            {rules.openingWindows === null
              ? "未知"
              : rules.openingWindows.length === 0
                ? "当天闭店"
                : rules.openingWindows
                    .map(
                      (window) =>
                        `${formatMinute(window.startMinute)}—${formatMinute(window.endMinute)}`,
                    )
                    .join("、")}
            。
          </p>
          <p>
            最晚入场：
            {rules.lastEntryMinute === null
              ? "未知"
              : formatMinute(rules.lastEntryMinute)}
            ；预约：{labels[rules.reservation.state]}。
          </p>
          <p>
            预约入场窗口：
            {rules.reservation.entryWindow
              ? `[${formatMinute(rules.reservation.entryWindow.startMinute)}, ${formatMinute(rules.reservation.entryWindow.endMinute)})`
              : "未知／不适用"}
            ，结束不含该时刻。
          </p>
          <p>用户记录（UTC）：{rules.source.recordedAt}。</p>
        </>
      )}
    </section>
  );
}
