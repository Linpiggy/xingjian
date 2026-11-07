/**
 * 全屏地图：查看某一天的完整路线，左侧（窄屏在下方）是站点与交通列表，与地图双向联动。
 * 使用原生 dialog：Esc 关闭、焦点限制在弹层内、关闭后焦点回到触发按钮。
 */
"use client";

import { BedDouble, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { duration, LEG_LABEL, stopLabel } from "@/lib/format";
import type { Day, Hotel } from "@/lib/schema";
import { formatDateLabel } from "@/lib/time";
import { TripMap } from "./trip-map";

export function MapOverlay({
  days,
  hotel,
  day,
  onDayChange,
  onClose,
  onLocate,
}: {
  days: Day[];
  hotel: Hotel | null;
  /** 当前查看的天；null 表示关闭 */
  day: number | null;
  onDayChange: (day: number) => void;
  onClose: () => void;
  /** 在手册中定位到该站点（会关闭弹层） */
  onLocate: (id: string) => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // 选中项与“天”绑定，切换天时自然失效，无需在 effect 中重置
  const [selection, setSelection] = useState<{ day: number | null; id: string | null }>({
    day: null,
    id: null,
  });
  const activeId = selection.day === day ? selection.id : null;
  const setActiveId = (id: string) => setSelection({ day, id });
  const current = days.find((item) => item.day === day) ?? null;

  useEffect(() => {
    const node = dialog.current;
    if (!node) {
      return;
    }
    if (day !== null && !node.open) {
      node.showModal();
    } else if (day === null && node.open) {
      node.close();
    }
  }, [day]);

  useEffect(() => {
    if (activeId) {
      document
        .getElementById(`overlay-${activeId}`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [activeId]);

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      aria-label={current ? `第 ${current.day} 天路线地图` : "路线地图"}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-paper p-0 text-ink backdrop:bg-ink/40"
    >
      {current ? (
        <div className="flex h-full flex-col">
          <header className="flex items-center gap-3 border-b border-line px-4 py-3 sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="text-xs text-ink-faint">
                第 {current.day} 天 · {formatDateLabel(current.date)}
              </p>
              <h2 className="truncate font-display text-xl">{current.theme}</h2>
            </div>
            <div className="flex gap-1" role="group" aria-label="切换天">
              {days.map((item) => (
                <button
                  key={item.day}
                  type="button"
                  aria-pressed={item.day === current.day}
                  onClick={() => onDayChange(item.day)}
                  className={`size-9 rounded-md text-sm tabular ${
                    item.day === current.day
                      ? "bg-pine text-white"
                      : "text-ink-soft hover:bg-paper-deep"
                  }`}
                >
                  {item.day}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭地图"
              className="grid size-9 place-items-center rounded-md text-ink-soft hover:bg-paper-deep hover:text-ink"
            >
              <X size={20} />
            </button>
          </header>

          <div className="grid min-h-0 flex-1 grid-rows-[55%_1fr] lg:grid-cols-[380px_1fr] lg:grid-rows-1">
            <TripMap
              key={current.day}
              days={[current]}
              hotel={hotel}
              activeId={activeId}
              onSelect={setActiveId}
              framed={false}
              className="h-full lg:order-2"
            />
            <ol className="min-h-0 overflow-y-auto border-t border-line bg-card px-3 py-3 lg:order-1 lg:border-r lg:border-t-0">
              {hotel && current.startLeg ? (
                <li className="flex items-center gap-2 px-2 py-2 text-sm text-ink-soft">
                  <BedDouble size={15} className="text-sky" aria-hidden />从{" "}
                  {hotel.place.name} 出发 · {LEG_LABEL[current.startLeg.mode]}{" "}
                  {duration(current.startLeg.minutes)}
                </li>
              ) : null}
              {current.stops.map((stop, index) => {
                const id = `${current.day}-${index}`;
                const leg = index > 0 ? current.legs[index - 1] : null;
                const active = activeId === id;
                return (
                  <li key={id} id={`overlay-${id}`}>
                    {leg ? (
                      <p className="py-1 pl-11 text-xs text-ink-faint">
                        {LEG_LABEL[leg.mode]} · {duration(leg.minutes)}
                      </p>
                    ) : null}
                    <div
                      className={`flex items-start gap-3 rounded-lg px-2 py-2 transition-colors ${
                        active ? "bg-pine-soft" : "hover:bg-paper"
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setActiveId(id)}
                        aria-pressed={active}
                        className="flex min-w-0 flex-1 items-start gap-3 text-left"
                      >
                        <span
                          className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold text-white ${
                            stop.kind === "meal" ? "bg-clay" : "bg-pine"
                          }`}
                        >
                          {index + 1}
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs tabular text-ink-faint">
                            {stop.start}–{stop.end} · {stopLabel(stop)}
                          </span>
                          <span className="block truncate font-medium">
                            {stop.place.name}
                          </span>
                        </span>
                      </button>
                      {active ? (
                        <button
                          type="button"
                          onClick={() => onLocate(id)}
                          className="shrink-0 rounded-md px-2 py-1 text-xs text-pine hover:bg-card"
                        >
                          看详情
                        </button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
              {hotel && current.endLeg ? (
                <li className="flex items-center gap-2 px-2 py-2 text-sm text-ink-soft">
                  <BedDouble size={15} className="text-sky" aria-hidden />
                  {LEG_LABEL[current.endLeg.mode]} {duration(current.endLeg.minutes)}{" "}
                  返回住处
                </li>
              ) : null}
            </ol>
          </div>
        </div>
      ) : null}
    </dialog>
  );
}
