"use client";

import {
  AlertTriangle,
  Bus,
  CarTaxiFront,
  Clock,
  Footprints,
  Lightbulb,
  Square,
  Star,
  Ticket,
  Volume2,
} from "lucide-react";
import { useSpeaker, useSpeechSupport } from "@/features/voice/speech";
import {
  dayNarration,
  distance,
  duration,
  LEG_LABEL,
  money,
  stopLabel,
} from "@/lib/format";
import type { Citation, Day, Leg, Stop } from "@/lib/schema";
import { formatDateLabel } from "@/lib/time";

const LEG_ICON = { walking: Footprints, transit: Bus, taxi: CarTaxiFront };

function LegRow({ leg }: { leg: Leg }) {
  const Icon = LEG_ICON[leg.mode];
  return (
    <li className="grid grid-cols-[56px_1fr] gap-3 sm:grid-cols-[72px_1fr] sm:gap-5">
      <div className="relative flex justify-center">
        <span className="absolute inset-y-0 w-px bg-line" aria-hidden />
      </div>
      <div className="flex items-start gap-2.5 py-3 text-sm">
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-full border border-line bg-paper text-ink-soft">
          <Icon size={14} aria-hidden />
        </span>
        <div className="min-w-0">
          <p className="text-ink-soft">
            <span className="font-medium text-ink">{LEG_LABEL[leg.mode]}</span>
            <span className="tabular"> · {duration(leg.minutes)}</span>
            {leg.meters ? (
              <span className="tabular"> · {distance(leg.meters)}</span>
            ) : null}
            {leg.costCny ? (
              <span className="tabular"> · 人均 {money(leg.costCny)}</span>
            ) : null}
          </p>
          {leg.mode !== "walking" || leg.minutes === null ? (
            <p className="text-xs leading-relaxed text-ink-faint">{leg.summary}</p>
          ) : null}
          {leg.alternative ? (
            <p className="text-xs text-ink-faint">或：{leg.alternative}</p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function StopCard({
  stop,
  id,
  active,
  index,
  citations,
  onFocus,
}: {
  stop: Stop;
  id: string;
  active: boolean;
  index: number;
  citations: Map<string, Citation>;
  onFocus: (id: string) => void;
}) {
  const meal = stop.kind === "meal";
  const photo = stop.place.photos[0];
  const cost = meal ? stop.mealCny : stop.ticketCny;
  return (
    <li
      id={`stop-${id}`}
      className="grid scroll-mt-28 grid-cols-[56px_1fr] gap-3 sm:grid-cols-[72px_1fr] sm:gap-5"
    >
      <div className="relative flex flex-col items-center">
        <span className="absolute inset-y-0 w-px bg-line" aria-hidden />
        <time className="relative z-10 bg-paper pb-1 pt-4 font-display text-base tabular text-ink sm:text-lg">
          {stop.start}
        </time>
        <span
          className={`relative z-10 grid size-6 place-items-center rounded-full text-[11px] font-semibold text-white ring-4 ring-paper ${
            meal ? "bg-clay" : "bg-pine"
          }`}
        >
          {index + 1}
        </span>
      </div>
      <article
        onClick={() => onFocus(id)}
        className={`my-2 cursor-pointer overflow-hidden rounded-xl border bg-card transition-all duration-200 ${
          active ? "border-pine shadow-lift" : "border-line hover:border-ink-faint"
        }`}
      >
        <div className={`grid ${photo ? "sm:grid-cols-[1fr_200px]" : ""}`}>
          <div className="p-4 sm:p-5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
              <span
                className={`rounded px-1.5 py-0.5 font-medium ${
                  meal ? "bg-clay-soft text-clay" : "bg-pine-soft text-pine-deep"
                }`}
              >
                {stopLabel(stop)}
              </span>
              <span className="flex items-center gap-1 tabular text-ink-faint">
                <Clock size={12} aria-hidden />
                {stop.start}–{stop.end} · {duration(stop.durationMin)}
              </span>
            </div>
            <h3 className="mt-2 font-display text-xl leading-snug text-ink">
              {stop.title || stop.place.name}
            </h3>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-ink-soft">
              <span>{stop.place.name}</span>
              {stop.place.rating ? (
                <span className="flex items-center gap-0.5 text-amber">
                  <Star size={12} fill="currentColor" aria-hidden />
                  <span className="tabular">{stop.place.rating.toFixed(1)}</span>
                </span>
              ) : null}
            </p>
            <p className="mt-3 text-[15px] leading-[1.8] text-ink">{stop.description}</p>

            {stop.highlights.length ? (
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {stop.highlights.map((item) => (
                  <li
                    key={item}
                    className="rounded-full border border-line-soft bg-paper px-2.5 py-0.5 text-xs text-ink-soft"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            ) : null}

            {stop.dishes.length ? (
              <p className="mt-3 text-sm text-ink-soft">
                <span className="font-medium text-clay">推荐点：</span>
                {stop.dishes.join("、")}
              </p>
            ) : null}

            {stop.tips.length ? (
              <ul className="mt-3 space-y-1">
                {stop.tips.map((tip) => (
                  <li key={tip} className="flex gap-1.5 text-sm text-ink-soft">
                    <Lightbulb
                      size={14}
                      className="mt-1 shrink-0 text-amber"
                      aria-hidden
                    />
                    {tip}
                  </li>
                ))}
              </ul>
            ) : null}

            {stop.warnings.length ? (
              <ul className="mt-3 space-y-1 rounded-md bg-amber-soft/70 px-3 py-2">
                {stop.warnings.map((warning) => (
                  <li key={warning} className="flex gap-1.5 text-xs text-amber">
                    <AlertTriangle size={13} className="mt-0.5 shrink-0" aria-hidden />
                    {warning}
                  </li>
                ))}
              </ul>
            ) : null}

            <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line-soft pt-3 text-xs text-ink-faint">
              <span className="flex items-center gap-1">
                <Ticket size={12} aria-hidden />
                {meal ? "人均" : "门票"} {cost === 0 ? "免费" : money(cost)}
                {cost !== null && cost > 0 ? "（估）" : ""}
              </span>
              {stop.place.openTime ? (
                <span
                  className="max-w-full truncate sm:max-w-80"
                  title={stop.place.openTime}
                >
                  营业 {stop.place.openTime}
                </span>
              ) : null}
              {stop.citations.map((cid) => {
                const citation = citations.get(cid);
                return citation ? (
                  <a
                    key={cid}
                    href={`#cite-${cid}`}
                    className="text-pine underline-offset-2 hover:underline"
                    onClick={(event) => event.stopPropagation()}
                  >
                    参考：{citation.title}
                  </a>
                ) : null;
              })}
            </div>
          </div>
          {photo ? (
            <div className="relative h-44 bg-paper-deep sm:h-auto">
              {/* 高德 POI 实景图，按原图展示，不经过 Next 图片优化代理 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={photo}
                alt={stop.place.name}
                loading="lazy"
                referrerPolicy="no-referrer"
                className="absolute inset-0 size-full object-cover"
              />
              <span className="absolute bottom-1.5 right-2 text-[10px] text-white/80 drop-shadow">
                图片：高德地图
              </span>
            </div>
          ) : null}
        </div>
      </article>
    </li>
  );
}

export function DayChapter({
  day,
  citations,
  activeId,
  onFocus,
  pending = false,
}: {
  day: Day;
  citations: Map<string, Citation>;
  activeId: string | null;
  onFocus: (id: string) => void;
  pending?: boolean;
}) {
  const { synthesis } = useSpeechSupport();
  const { speaking, speak, stop } = useSpeaker();
  return (
    <section
      id={`day-${day.day}`}
      data-day={day.day}
      className="print-break animate-rise scroll-mt-24 pt-14"
    >
      <header className="grid grid-cols-[auto_1fr] items-end gap-x-5 border-b border-ink pb-5">
        <span
          className="font-display text-[72px] leading-[0.85] text-pine sm:text-[96px]"
          aria-hidden
        >
          {String(day.day).padStart(2, "0")}
        </span>
        <div className="min-w-0">
          <p className="text-sm text-ink-soft">
            第 {day.day} 天 · {formatDateLabel(day.date)}
            {day.weather
              ? ` · ${day.weather.dayWeather} ${day.weather.low}°–${day.weather.high}°`
              : ""}
          </p>
          <h2 className="mt-1 font-display text-[28px] leading-tight text-ink sm:text-[34px]">
            {day.theme}
          </h2>
        </div>
      </header>
      <div className="mt-4 flex items-start justify-between gap-4">
        <p className="text-[15px] leading-[1.85] text-ink-soft">{day.summary}</p>
        {synthesis && !pending ? (
          <button
            type="button"
            onClick={() => (speaking ? stop() : speak(dayNarration(day)))}
            className="no-print flex shrink-0 items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm text-ink-soft hover:bg-paper-deep hover:text-ink"
            aria-label={speaking ? "停止朗读" : `朗读第 ${day.day} 天行程`}
          >
            {speaking ? (
              <Square size={14} aria-hidden />
            ) : (
              <Volume2 size={15} aria-hidden />
            )}
            {speaking ? "停止" : "朗读"}
          </button>
        ) : null}
      </div>

      {day.warnings.length ? (
        <ul className="mt-4 space-y-1 rounded-lg border border-amber/25 bg-amber-soft/60 px-4 py-3">
          {day.warnings.map((warning) => (
            <li key={warning} className="flex gap-2 text-sm text-amber">
              <AlertTriangle size={15} className="mt-1 shrink-0" aria-hidden />
              {warning}
            </li>
          ))}
        </ul>
      ) : null}

      <ol className="mt-4">
        {day.stops.map((stop, index) => {
          const id = `${day.day}-${index}`;
          return [
            index > 0 && day.legs[index - 1] ? (
              <LegRow key={`leg-${id}`} leg={day.legs[index - 1]} />
            ) : null,
            <StopCard
              key={id}
              id={id}
              stop={stop}
              index={index}
              active={activeId === id}
              citations={citations}
              onFocus={onFocus}
            />,
          ];
        })}
      </ol>
    </section>
  );
}
