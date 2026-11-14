"use client";

import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  BedDouble,
  Bus,
  CarTaxiFront,
  Clock,
  Footprints,
  Lightbulb,
  Loader2,
  Lock,
  LockOpen,
  Maximize2,
  Minus,
  Plus,
  Repeat,
  Square,
  Star,
  Ticket,
  TrainFront,
  Trash2,
  Volume2,
} from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { PlacePhoto } from "@/components/place-photo";
import { useSpeaker, useSpeechSupport } from "@/features/voice/speech";
import {
  dayNarration,
  distance,
  duration,
  LEG_LABEL,
  money,
  stopLabel,
} from "@/lib/format";
import type { Citation, Day, Hotel, Intercity, Leg, Stop } from "@/lib/schema";
import { LazyMount } from "@/components/lazy-mount";
import { TripMap } from "@/features/map/trip-map";
import type { DayEditor } from "./use-trip-editor";
import { formatDateLabel } from "@/lib/time";

/** 推荐菜是否属于高德收录的招牌菜（名称互相包含即算，兼容“精品”等前缀差异） */
function isSignature(dish: string, signature: string[]): boolean {
  return signature.some((item) => item.includes(dish) || dish.includes(item));
}

const LEG_ICON = { walking: Footprints, transit: Bus, taxi: CarTaxiFront };

function LegRow({ leg, label }: { leg: Leg; label?: string }) {
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
            {label ? <span className="text-ink-faint">{label} · </span> : null}
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

function TrainRow({ text }: { text: string }) {
  return (
    <li className="grid grid-cols-[56px_1fr] gap-3 sm:grid-cols-[72px_1fr] sm:gap-5">
      <div className="relative flex justify-center">
        <span className="absolute inset-y-0 w-px bg-line" aria-hidden />
        <span className="relative z-10 mt-2 grid size-7 place-items-center rounded-full bg-ink text-paper ring-4 ring-paper">
          <TrainFront size={14} aria-hidden />
        </span>
      </div>
      <p className="py-2.5 text-sm font-medium text-ink">{text}</p>
    </li>
  );
}

function HotelRow({ hotel, text }: { hotel: Hotel; text: string }) {
  return (
    <li className="grid grid-cols-[56px_1fr] gap-3 sm:grid-cols-[72px_1fr] sm:gap-5">
      <div className="relative flex justify-center">
        <span className="absolute inset-y-0 w-px bg-line" aria-hidden />
        <span className="relative z-10 mt-2 grid size-7 place-items-center rounded-full bg-sky text-white ring-4 ring-paper">
          <BedDouble size={14} aria-hidden />
        </span>
      </div>
      <p className="py-2.5 text-sm text-ink-soft">
        {text}
        <span className="font-medium text-ink">{hotel.place.name}</span>
      </p>
    </li>
  );
}

function ToolButton({
  label,
  onClick,
  disabled,
  pressed,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  pressed?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`grid size-8 place-items-center rounded-md transition-colors disabled:opacity-30 ${
        pressed
          ? "bg-pine-soft text-pine-deep"
          : "text-ink-soft hover:bg-paper-deep hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}

function StopToolbar({
  stop,
  day,
  index,
  count,
  editor,
  onSwap,
}: {
  stop: Stop;
  day: number;
  index: number;
  count: number;
  editor: DayEditor;
  onSwap: (day: number, index: number) => void;
}) {
  const busy = editor.busyDay !== null;
  const locked = stop.locked;
  return (
    <div
      className="no-print flex flex-wrap items-center gap-0.5 border-t border-line-soft bg-paper/60 px-2 py-1"
      onClick={(event) => event.stopPropagation()}
    >
      <ToolButton
        label={locked ? "解除锁定" : "锁定（AI 调整时保留）"}
        pressed={locked}
        onClick={() => editor.lock(day, index)}
      >
        {locked ? <Lock size={15} /> : <LockOpen size={15} />}
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <ToolButton
        label="上移"
        disabled={busy || index === 0}
        onClick={() => editor.move(day, index, -1)}
      >
        <ArrowUp size={15} />
      </ToolButton>
      <ToolButton
        label="下移"
        disabled={busy || index === count - 1}
        onClick={() => editor.move(day, index, 1)}
      >
        <ArrowDown size={15} />
      </ToolButton>
      <ToolButton
        label="缩短 30 分钟"
        disabled={busy || stop.durationMin <= 15}
        onClick={() => editor.resize(day, index, -30)}
      >
        <Minus size={15} />
      </ToolButton>
      <ToolButton
        label="延长 30 分钟"
        disabled={busy || stop.durationMin >= 480}
        onClick={() => editor.resize(day, index, 30)}
      >
        <Plus size={15} />
      </ToolButton>
      <span className="mx-1 h-4 w-px bg-line" aria-hidden />
      <button
        type="button"
        disabled={busy || locked}
        onClick={() => onSwap(day, index)}
        className="flex h-8 items-center gap-1 rounded-md px-2 text-xs text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink disabled:opacity-30"
      >
        <Repeat size={14} aria-hidden />
        <span className="sr-only sm:not-sr-only">换一个</span>
      </button>
      <ToolButton
        label="删除这一站"
        disabled={busy || locked || count <= 1}
        onClick={() => editor.remove(day, index)}
      >
        <Trash2 size={15} />
      </ToolButton>
      {locked ? <span className="ml-auto pr-2 text-[11px] text-pine">已锁定</span> : null}
    </div>
  );
}

function StopCard({
  stop,
  id,
  active,
  index,
  citations,
  onFocus,
  toolbar,
}: {
  stop: Stop;
  id: string;
  active: boolean;
  index: number;
  citations: Map<string, Citation>;
  onFocus: (id: string) => void;
  toolbar?: ReactNode;
}) {
  const meal = stop.kind === "meal";
  const [photoFailed, setPhotoFailed] = useState(false);
  const photo = photoFailed ? undefined : stop.place.photos[0];
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
              {stop.locked ? (
                <span className="flex items-center gap-0.5 text-pine">
                  <Lock size={11} aria-hidden />
                  锁定
                </span>
              ) : null}
              {stop.userEdited ? (
                <span className="text-ink-faint">· 手动调整</span>
              ) : null}
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
              <div className="mt-3">
                <p className="text-sm font-medium text-clay">推荐点</p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {stop.dishes.map((dish) => {
                    const signature = isSignature(dish, stop.place.signatureDishes);
                    return (
                      <li
                        key={dish}
                        className="flex items-center gap-1 rounded-md bg-clay-soft/70 px-2 py-0.5 text-sm text-ink"
                        title={signature ? "高德收录的该店招牌菜" : "AI 根据当地口味推荐"}
                      >
                        {dish}
                        {signature ? (
                          <span className="rounded bg-clay px-1 text-[10px] leading-4 text-white">
                            招牌
                          </span>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
                {stop.dishes.some(
                  (dish) => !isSignature(dish, stop.place.signatureDishes),
                ) ? (
                  <p className="mt-1 text-xs text-ink-faint">
                    未标“招牌”的为 AI 按当地口味推荐，以店内菜单为准。
                  </p>
                ) : null}
              </div>
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
                {cost !== null && cost > 0 && !stop.ticketSource ? "（估）" : ""}
              </span>
              {stop.ticketSource ? (
                <a
                  href={stop.ticketSource.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(event) => event.stopPropagation()}
                  title={`${stop.ticketSource.title}（${stop.ticketSource.checkedAt} 联网核对）`}
                  className="flex max-w-60 items-center gap-1 truncate text-pine hover:underline"
                >
                  <span
                    className={`rounded px-1 text-[10px] leading-4 ${
                      stop.ticketSource.official
                        ? "bg-pine text-white"
                        : "bg-paper-deep text-ink-soft"
                    }`}
                  >
                    {stop.ticketSource.official ? "官方核对" : "网络信息"}
                  </span>
                  <span className="truncate">{stop.ticketSource.title}</span>
                </a>
              ) : null}
              {stop.place.openTime ? (
                <span
                  className="max-w-full truncate sm:max-w-80"
                  title={stop.place.openTime}
                >
                  营业 {stop.place.openTime}
                </span>
              ) : null}
              {meal && stop.place.tel ? (
                <a
                  href={`tel:${stop.place.tel}`}
                  onClick={(event) => event.stopPropagation()}
                  className="tabular hover:text-ink"
                >
                  订座电话 {stop.place.tel}
                </a>
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
              <PlacePhoto
                src={photo}
                alt={stop.place.name}
                onUnavailable={() => setPhotoFailed(true)}
                className="absolute inset-0 size-full object-cover"
              />
              <span className="absolute bottom-1.5 right-2 text-[10px] text-white/80 drop-shadow">
                图片：高德地图
              </span>
            </div>
          ) : null}
        </div>
        {toolbar}
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
  hotel = null,
  editor,
  onSwap,
  onExpandMap,
  intercity = null,
  totalDays = 0,
}: {
  day: Day;
  citations: Map<string, Citation>;
  activeId: string | null;
  onFocus: (id: string) => void;
  pending?: boolean;
  hotel?: Hotel | null;
  editor?: DayEditor;
  onSwap?: (day: number, index: number) => void;
  /** 提供时在章节开头显示当天路线图，并可打开全屏地图 */
  onExpandMap?: (day: number) => void;
  intercity?: Intercity | null;
  totalDays?: number;
}) {
  const busy = editor?.busyDay === day.day;
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

      {onExpandMap ? (
        <div className="no-print relative mt-6">
          <LazyMount
            placeholder={
              <div className="h-[260px] rounded-2xl bg-paper-deep sm:h-[340px]" />
            }
          >
            <TripMap
              days={[day]}
              hotel={hotel}
              activeId={activeId}
              onSelect={onFocus}
              className="h-[260px] sm:h-[340px]"
            />
          </LazyMount>
          <button
            type="button"
            onClick={() => onExpandMap(day.day)}
            className="absolute right-3 top-3 flex items-center gap-1.5 rounded-lg bg-card/95 px-3 py-1.5 text-sm text-ink shadow-lift transition-colors hover:bg-card"
          >
            <Maximize2 size={14} aria-hidden />
            全屏查看
          </button>
        </div>
      ) : null}

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

      {busy ? (
        <p
          className="no-print mt-4 flex items-center gap-2 text-sm text-pine"
          role="status"
        >
          <Loader2 size={15} className="animate-spin" aria-hidden />
          正在用真实路线重新计算这一天的时间…
        </p>
      ) : null}

      <ol className={`mt-4 transition-opacity ${busy ? "opacity-50" : ""}`}>
        {intercity?.outbound && day.day === 1 ? (
          <TrainRow
            text={`乘 ${intercity.outbound.trip} 抵达：${intercity.outbound.from} ${intercity.outbound.depart} → ${intercity.outbound.to} ${intercity.outbound.arrive}`}
          />
        ) : null}
        {hotel && day.startLeg ? (
          <>
            <HotelRow hotel={hotel} text="从住处出发：" />
            <LegRow leg={day.startLeg} label="前往第一站" />
          </>
        ) : null}
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
              toolbar={
                editor && onSwap ? (
                  <StopToolbar
                    stop={stop}
                    day={day.day}
                    index={index}
                    count={day.stops.length}
                    editor={editor}
                    onSwap={onSwap}
                  />
                ) : null
              }
            />,
          ];
        })}
        {hotel && day.endLeg ? (
          <>
            <LegRow leg={day.endLeg} label="返回住处" />
            <HotelRow hotel={hotel} text="回到住处休息：" />
          </>
        ) : null}
        {intercity?.inbound && day.day === totalDays ? (
          <TrainRow
            text={`前往${intercity.inbound.from}，乘 ${intercity.inbound.trip} ${intercity.inbound.depart} 返程（到 ${intercity.inbound.to} ${intercity.inbound.arrive}）`}
          />
        ) : null}
      </ol>
    </section>
  );
}
