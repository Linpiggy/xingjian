/** 往返车次卡片：车次、站点、时刻与各席别票价（高德时刻表数据，余票与最终票价以 12306 为准） */
"use client";

import { ExternalLink, TrainFront } from "lucide-react";
import { duration, money } from "@/lib/format";
import type { Intercity, Train } from "@/lib/schema";
import { formatDateLabel } from "@/lib/time";

function TrainRow({ label, train }: { label: string; train: Train }) {
  return (
    <li className="grid gap-3 py-4 sm:grid-cols-[88px_1fr_auto] sm:items-center">
      <div>
        <p className="text-xs text-ink-faint">{label}</p>
        <p className="font-display text-xl text-ink">{train.trip}</p>
      </div>
      <div className="flex items-center gap-3">
        <div className="text-right">
          <p className="font-display text-xl tabular text-ink">{train.depart}</p>
          <p className="text-xs text-ink-soft">{train.from}</p>
        </div>
        <div className="flex min-w-16 flex-1 flex-col items-center text-[11px] text-ink-faint">
          <span>{duration(train.minutes)}</span>
          <span className="my-0.5 h-px w-full bg-line" aria-hidden />
          <span>{formatDateLabel(train.date)}</span>
        </div>
        <div>
          <p className="font-display text-xl tabular text-ink">
            {train.arrive}
            {train.arriveNextDay ? (
              <sup className="ml-0.5 text-[10px] text-clay">+1</sup>
            ) : null}
          </p>
          <p className="text-xs text-ink-soft">{train.to}</p>
        </div>
      </div>
      <ul className="flex flex-wrap gap-1.5 sm:justify-end">
        {train.seats.slice(0, 3).map((seat) => (
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
        {intercity.outbound ? <TrainRow label="去程" train={intercity.outbound} /> : null}
        {intercity.inbound ? <TrainRow label="返程" train={intercity.inbound} /> : null}
      </ul>
      <p className="border-t border-line-soft py-3 text-xs leading-relaxed text-ink-faint">
        {intercity.note ? `${intercity.note} ` : ""}
        车次、时刻与票价来自高德跨城交通数据，不含余票信息；出发前请在 12306
        确认余票与实际票价。
      </p>
    </section>
  );
}
