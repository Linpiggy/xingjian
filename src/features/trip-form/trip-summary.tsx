import { CalendarDays, MapPin, Users, Wallet } from "lucide-react";
import type { PlaceCandidate } from "@/domain/models";
import { groupPlaces } from "@/domain/draft";

const currency = new Intl.NumberFormat("zh-CN", {
  style: "currency",
  currency: "CNY",
  maximumFractionDigits: 2,
});

export function TripSummary({
  city,
  departureDate,
  dayCount,
  travelers,
  budgetPerPersonFen,
  selected,
}: {
  city: string;
  departureDate: string;
  dayCount: number;
  travelers: string;
  budgetPerPersonFen: number | null;
  selected: PlaceCandidate[];
}) {
  const travelerCount = Number(travelers);
  const validTravelers =
    Number.isInteger(travelerCount) && travelerCount >= 1 && travelerCount <= 8;
  const groups = groupPlaces(
    selected.map((candidate) => candidate.place),
    dayCount,
  );

  return (
    <aside className="panel trip-summary" aria-labelledby="trip-summary-title">
      <h2 id="trip-summary-title">旅行摘要</h2>
      <p className="summary-destination">
        <MapPin size={20} aria-hidden="true" />
        {city.trim() || "选择目的地"}
        <span>{dayCount} 天</span>
      </p>
      <dl className="summary-facts">
        <div>
          <dt>
            <CalendarDays size={16} aria-hidden="true" />
            出发日期
          </dt>
          <dd>{departureDate ? departureDate.replaceAll("-", ".") : "未选择日期"}</dd>
        </div>
        <div>
          <dt>
            <Users size={16} aria-hidden="true" />
            同行人数
          </dt>
          <dd>{validTravelers ? `${travelerCount} 人` : "请填写 1-8 人"}</dd>
        </div>
        <div>
          <dt>
            <Wallet size={16} aria-hidden="true" />
            每人预算目标
          </dt>
          <dd>
            {budgetPerPersonFen === null
              ? "未填写有效预算"
              : currency.format(budgetPerPersonFen / 100)}
          </dd>
        </div>
      </dl>
      <hr />
      <h3>每日地点预览</h3>
      {selected.length ? (
        <ol className="summary-days">
          {groups.map((places, index) => (
            <li key={index}>
              <strong>第 {index + 1} 天</strong>
              {places.length ? (
                <ul>
                  {places.map((place) => (
                    <li key={place.id}>{place.name}</li>
                  ))}
                </ul>
              ) : (
                <p className="small muted">还没有地点</p>
              )}
            </li>
          ))}
        </ol>
      ) : (
        <p className="summary-empty">添加想去的地点，在这里查看每天的安排。</p>
      )}
      <p className="small muted">按清单顺序分天；具体时间将在生成路线后估算。</p>
      {selected.some((candidate) => candidate.place.source.kind === "fixture") && (
        <p className="small error-text">测试 fixture 地点，非真实行程。</p>
      )}
      <div className="notice summary-reminder">
        <p>出行前请确认开放时间、预约要求与费用。预算仅为目标，不是费用报价。</p>
      </div>
    </aside>
  );
}
