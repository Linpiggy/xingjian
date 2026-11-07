"use client";

import { CloudRain, CloudSun, Snowflake, Sun } from "lucide-react";
import { money } from "@/lib/format";
import type { Trip, TripRequest, Weather } from "@/lib/schema";
import { formatDateLabel } from "@/lib/time";

function WeatherIcon({ weather }: { weather: Weather }) {
  const text = weather.dayWeather;
  if (/雪/.test(text)) {
    return <Snowflake size={18} className="text-sky" aria-hidden />;
  }
  if (/雨|雷/.test(text)) {
    return <CloudRain size={18} className="text-sky" aria-hidden />;
  }
  if (/晴/.test(text)) {
    return <Sun size={18} className="text-amber" aria-hidden />;
  }
  return <CloudSun size={18} className="text-ink-soft" aria-hidden />;
}

const BUDGET_PARTS = [
  { key: "tickets", label: "门票", color: "bg-pine" },
  { key: "meals", label: "餐饮", color: "bg-clay" },
  { key: "transport", label: "市内交通", color: "bg-sky" },
  { key: "hotel", label: "住宿", color: "bg-amber" },
] as const;

export function TripOverview({ trip, request }: { trip: Trip; request: TripRequest }) {
  const { budget } = trip;
  const sights = trip.days
    .flatMap((day) => day.stops)
    .filter((stop) => stop.kind === "sight").length;
  const meals = trip.days
    .flatMap((day) => day.stops)
    .filter((stop) => stop.kind === "meal").length;
  const over = request.budgetPerPerson !== null && budget.total > request.budgetPerPerson;

  return (
    <section id="overview" className="scroll-mt-24">
      <p className="text-[17px] leading-[1.95] text-ink first-letter:float-left first-letter:mr-2 first-letter:font-display first-letter:text-[3.4rem] first-letter:leading-[0.95] first-letter:text-pine">
        {trip.overview}
      </p>

      <dl className="mt-8 grid grid-cols-3 divide-x divide-line border-y border-line py-4 text-center">
        <div>
          <dt className="text-xs text-ink-faint">天数</dt>
          <dd className="font-display text-2xl tabular">{trip.days.length}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">景点</dt>
          <dd className="font-display text-2xl tabular">{sights}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-faint">餐食</dt>
          <dd className="font-display text-2xl tabular">{meals}</dd>
        </div>
      </dl>

      <div className="mt-8 grid gap-8 md:grid-cols-2">
        <div>
          <h2 className="font-display text-xl text-ink">天气</h2>
          <ul className="mt-3 divide-y divide-line-soft">
            {trip.days.map((day) => (
              <li
                key={day.day}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="text-ink-soft">
                  第 {day.day} 天{" "}
                  <span className="text-ink-faint">· {formatDateLabel(day.date)}</span>
                </span>
                {day.weather ? (
                  <span className="flex items-center gap-2 text-ink">
                    <WeatherIcon weather={day.weather} />
                    {day.weather.dayWeather}
                    <span className="tabular text-ink-soft">
                      {day.weather.low}°–{day.weather.high}°
                    </span>
                  </span>
                ) : (
                  <span className="text-ink-faint">超出预报范围</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-ink-faint">
            高德天气预报覆盖未来 4 天，临近出发再看一次。
          </p>
        </div>

        <div>
          <div className="flex items-baseline justify-between">
            <h2 className="font-display text-xl text-ink">人均预算</h2>
            <span
              className={`font-display text-2xl tabular ${over ? "text-danger" : "text-ink"}`}
            >
              {money(budget.total)}
            </span>
          </div>
          {request.budgetPerPerson !== null ? (
            <p className={`text-xs ${over ? "text-danger" : "text-ink-faint"}`}>
              {over
                ? `超出你设定的 ${money(request.budgetPerPerson)}，可让 AI 调整为更省的方案`
                : `在你设定的 ${money(request.budgetPerPerson)} 以内`}
            </p>
          ) : null}
          <div
            className="mt-4 flex h-2.5 overflow-hidden rounded-full bg-paper-deep"
            aria-hidden
          >
            {BUDGET_PARTS.map((part) => {
              const value = budget[part.key];
              return value && budget.total ? (
                <div
                  key={part.key}
                  className={part.color}
                  style={{ width: `${(value / budget.total) * 100}%` }}
                />
              ) : null;
            })}
          </div>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
            {BUDGET_PARTS.map((part) => (
              <li key={part.key} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-ink-soft">
                  <i className={`size-2 rounded-full ${part.color}`} />
                  {part.label}
                </span>
                <span
                  className={`tabular ${budget[part.key] === null ? "text-ink-faint" : "text-ink"}`}
                >
                  {money(budget[part.key])}
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs leading-relaxed text-ink-faint">
            住宿：{budget.hotelNote}。门票与餐费为 AI 估算，交通费来自高德路线。
            {budget.unknownItems.length
              ? ` 未计入：${budget.unknownItems.join("、")}。`
              : ""}
          </p>
        </div>
      </div>
    </section>
  );
}
