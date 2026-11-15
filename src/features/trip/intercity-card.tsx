/**
 * 往返车次卡片：每趟车列出全部车次段（中转时逐段显示换乘站与等候时间）、各席别票价，
 * 数据来自高德跨城交通（时刻表与票价，不含余票），余票与最终票价以 12306 为准。
 */
"use client";

import { ArrowRightLeft, ExternalLink, TrainFront } from "lucide-react";
import { duration, money } from "@/lib/format";
import type { Intercity, Train, TrainLeg } from "@/lib/schema";
import { formatDateLabel } from "@/lib/time";
import { trainFare, trainLegs, transferWait } from "@/lib/train";

function Clock({ time, offset }: { time: string; offset: number }) {
  return (
    <span className="font-display tabular text-ink">
      {time}
      {offset > 0 ? (
        <sup
          className="ml-0.5 font-sans text-[10px] text-clay"
          title={`出发后第 ${offset} 天`}
        >
          +{offset}
        </sup>
      ) : null}
    </span>
  );
}

function LegRow({ leg }: { leg: TrainLeg }) {
  return (
    <li className="grid gap-2 py-2.5 sm:grid-cols-[96px_1fr_auto] sm:items-center">
      <span className="w-fit rounded-md bg-ink px-2 py-0.5 font-display text-sm text-paper">
        {leg.trip}
      </span>
      <div className="flex items-center gap-3 text-sm">
        <div className="text-right">
          <Clock time={leg.depart} offset={leg.departDayOffset} />
          <p className="text-xs text-ink-soft">{leg.from}</p>
        </div>
        <div className="flex min-w-14 flex-1 flex-col items-center text-[11px] text-ink-faint">
          <span>{duration(leg.minutes)}</span>
          <span className="my-0.5 h-px w-full bg-line" aria-hidden />
        </div>
        <div>
          <Clock time={leg.arrive} offset={leg.arriveDayOffset} />
          <p className="text-xs text-ink-soft">{leg.to}</p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5 sm:justify-end">
        {leg.seats.slice(0, 3).map((seat) => (
          <li
            key={seat.name}
            className="rounded-md bg-paper-deep px-2 py-0.5 text-xs tabular text-ink-soft"
          >
            {seat.name} {money(seat.price)}
            {seat.maxPrice && seat.maxPrice > seat.price ? `–${seat.maxPrice}` : ""}
          </li>
        ))}
      </ul>
    </li>
  );
}

function TransferRow({ previous, next }: { previous: TrainLeg; next: TrainLeg }) {
  const wait = transferWait(previous, next);
  const changeStation = previous.to !== next.from;
  return (
    <li className="flex items-center gap-2 rounded-md bg-amber-soft/60 px-3 py-1.5 text-xs text-amber">
      <ArrowRightLeft size={13} aria-hidden />
      {changeStation
        ? `${previous.to} 出站，前往 ${next.from} 换乘`
        : `在 ${previous.to} 换乘`}
      <span className="tabular">· 等候 {duration(wait)}</span>
      {wait < 30 ? <span>· 换乘时间紧张</span> : null}
    </li>
  );
}

function JourneyRow({ label, train }: { label: string; train: Train }) {
  const legs = trainLegs(train);
  const fare = trainFare(train);
  return (
    <li className="py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="flex flex-wrap items-baseline gap-x-3">
          <span className="text-xs text-ink-faint">{label}</span>
          <span className="text-lg">
            <Clock time={train.depart} offset={0} />
            <span className="mx-1.5 text-ink-faint">→</span>
            <Clock time={train.arrive} offset={train.arriveDayOffset} />
          </span>
          <span className="text-sm text-ink-soft">
            {train.from} → {train.to}
          </span>
        </p>
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-ink-soft [&>span]:whitespace-nowrap">
          <span>{formatDateLabel(train.date)} 出发</span>
          <span>· 全程 {duration(train.minutes)}</span>
          <span
            className={`rounded px-1.5 py-0.5 ${legs.length > 1 ? "bg-amber-soft text-amber" : "bg-pine-soft text-pine-deep"}`}
          >
            {legs.length > 1 ? `中转 ${legs.length - 1} 次` : "直达"}
          </span>
          {fare !== null ? <span className="tabular">· 每人约 {money(fare)}</span> : null}
        </p>
      </div>
      <ol className="mt-2 space-y-1">
        {legs.map((leg, index) => [
          index > 0 ? (
            <TransferRow
              key={`transfer-${index}`}
              previous={legs[index - 1]}
              next={leg}
            />
          ) : null,
          <LegRow key={`${leg.trip}-${index}`} leg={leg} />,
        ])}
      </ol>
    </li>
  );
}

export function IntercityCard({ intercity }: { intercity: Intercity }) {
  if (!intercity.outbound && !intercity.inbound) {
    return intercity.note ? (
      <div className="mt-8 rounded-xl border border-line bg-card p-4 text-sm text-ink-soft sm:p-5">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          <TrainFront size={16} className="text-sky" aria-hidden />
          往返交通（{intercity.origin}出发）
        </p>
        <p className="mt-1">{intercity.note}</p>
      </div>
    ) : null;
  }
  return (
    <section
      className="mt-8 rounded-xl border border-line bg-card px-4 pt-4 sm:px-5"
      aria-label="往返车次"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-1.5 font-display text-xl text-ink">
          <TrainFront size={18} className="text-sky" aria-hidden />
          往返车次
          <span className="font-sans text-sm text-ink-faint">
            · {intercity.origin}出发
          </span>
        </h2>
        <a
          href="https://www.12306.cn/index/"
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1 text-sm text-pine hover:underline"
        >
          去 12306 购票
          <ExternalLink size={13} aria-hidden />
        </a>
      </div>
      <ul className="divide-y divide-line-soft">
        {intercity.outbound ? (
          <JourneyRow label="去程" train={intercity.outbound} />
        ) : null}
        {intercity.inbound ? <JourneyRow label="返程" train={intercity.inbound} /> : null}
      </ul>
      <p className="border-t border-line-soft py-3 text-xs leading-relaxed text-ink-faint">
        {intercity.note ? `${intercity.note} ` : ""}
        车次、时刻与票价来自高德跨城交通数据，不含余票信息；中转方案需分别购票，出发前请在
        12306 确认余票与实际票价。
      </p>
    </section>
  );
}
