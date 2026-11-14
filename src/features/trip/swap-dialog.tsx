"use client";

import { MapPin, Star, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { distance, money } from "@/lib/format";
import { PlacePhoto } from "@/components/place-photo";
import { distanceMeters } from "@/lib/geo";
import type { Place, Stop } from "@/lib/schema";

export function SwapDialog({
  stop,
  candidates,
  onPick,
  onClose,
}: {
  stop: Stop | null;
  candidates: Place[];
  onPick: (place: Place) => void;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const node = dialog.current;
    if (!node) {
      return;
    }
    if (stop && !node.open) {
      node.showModal();
    } else if (!stop && node.open) {
      node.close();
    }
  }, [stop]);

  const wantFood = stop?.kind === "meal";
  const options = stop
    ? candidates
        .filter((place) =>
          wantFood
            ? place.category === "food"
            : place.category === "sight" || place.category === "other",
        )
        .map((place) => ({
          place,
          meters: distanceMeters(stop.place.location, place.location),
        }))
        .sort((a, b) => a.meters - b.meters)
        .slice(0, 12)
    : [];

  return (
    <dialog
      ref={dialog}
      onClose={onClose}
      onClick={(event) => {
        if (event.target === dialog.current) {
          onClose();
        }
      }}
      aria-labelledby="swap-title"
      className="m-auto w-[min(560px,calc(100vw-24px))] rounded-2xl border border-line bg-card p-0 text-ink shadow-float backdrop:bg-ink/40"
    >
      {stop ? (
        <div className="flex max-h-[min(640px,85dvh)] flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line-soft px-5 py-4">
            <div>
              <h2 id="swap-title" className="font-display text-xl">
                换一个{wantFood ? "餐厅" : "地点"}
              </h2>
              <p className="mt-0.5 text-sm text-ink-soft">
                替换「{stop.place.name}」，按离原地点由近到远排列
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭"
              className="rounded-md p-1.5 text-ink-soft hover:bg-paper-deep"
            >
              <X size={18} />
            </button>
          </div>
          {options.length ? (
            <ul className="overflow-y-auto p-2">
              {options.map(({ place, meters }) => (
                <li key={place.id}>
                  <button
                    type="button"
                    onClick={() => onPick(place)}
                    className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-paper focus-visible:bg-paper"
                  >
                    <span className="relative size-14 shrink-0 overflow-hidden rounded-md bg-paper-deep">
                      {place.photos[0] ? (
                        <PlacePhoto
                          src={place.photos[0]}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <MapPin
                          size={18}
                          className="absolute inset-0 m-auto text-ink-faint"
                          aria-hidden
                        />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{place.name}</span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
                        {place.type ? <span>{place.type}</span> : null}
                        {place.rating ? (
                          <span className="flex items-center gap-0.5 text-amber">
                            <Star size={11} fill="currentColor" aria-hidden />
                            {place.rating.toFixed(1)}
                          </span>
                        ) : null}
                        {wantFood && place.avgCost ? (
                          <span>人均 {money(place.avgCost)}</span>
                        ) : null}
                        <span>距原地点 {distance(Math.round(meters))}</span>
                      </span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-5 py-10 text-center text-sm text-ink-soft">
              Agent 这次没有找到其他合适的{wantFood ? "餐厅" : "地点"}
              。可以在下方对话框里描述想换成什么，让 AI 重新搜索。
            </p>
          )}
          <p className="border-t border-line-soft px-5 py-3 text-xs text-ink-faint">
            替换后会用真实路线重新计算当天时间，不消耗 AI 调用。
          </p>
        </div>
      ) : null}
    </dialog>
  );
}
