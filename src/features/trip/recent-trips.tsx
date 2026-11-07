"use client";

import { Trash2 } from "lucide-react";
import Link from "next/link";
import { formatDateLabel } from "@/lib/time";
import { useHydrated } from "@/lib/use-hydrated";
import { useTrips } from "@/store/trips";

export function RecentTrips({ full = false }: { full?: boolean }) {
  const hydrated = useHydrated();
  const order = useTrips((state) => state.order);
  const records = useTrips((state) => state.records);
  const remove = useTrips((state) => state.remove);
  if (!hydrated) {
    return null;
  }
  const items = order.map((id) => records[id]).filter(Boolean);
  if (!items.length) {
    return full ? (
      <div className="rounded-2xl border border-dashed border-line px-6 py-16 text-center">
        <p className="text-ink-soft">还没有行程。</p>
        <Link
          href="/#planner"
          className="mt-4 inline-flex h-11 items-center rounded-lg bg-pine px-5 text-white"
        >
          规划第一次旅行
        </Link>
      </div>
    ) : null;
  }
  return (
    <div className={full ? "" : "mt-16"}>
      {full ? null : <h2 className="font-display text-2xl text-ink">最近的行程</h2>}
      <ul className={`grid gap-3 sm:grid-cols-2 lg:grid-cols-3 ${full ? "" : "mt-5"}`}>
        {(full ? items : items.slice(0, 3)).map((record) => (
          <li
            key={record.id}
            className="group relative rounded-xl border border-line bg-card transition-colors hover:border-ink-faint"
          >
            <Link href={`/plan/${record.id}`} className="block p-5">
              <p className="text-xs text-ink-faint">
                {formatDateLabel(record.request.startDate)} · {record.request.days} 天 ·{" "}
                {record.request.travelers} 人
              </p>
              <p className="mt-1.5 font-display text-xl text-ink">
                {record.trip?.title ?? `${record.request.city}之旅`}
              </p>
              <p className="mt-1 line-clamp-2 text-sm text-ink-soft">
                {record.trip?.subtitle ??
                  (record.run === "error" ? (record.error ?? "未完成") : "规划中")}
              </p>
            </Link>
            {full ? (
              <button
                type="button"
                onClick={() => remove(record.id)}
                aria-label={`删除 ${record.trip?.title ?? record.request.city}`}
                className="absolute right-3 top-3 rounded-md p-1.5 text-ink-faint opacity-0 transition-opacity hover:bg-paper-deep hover:text-danger focus:opacity-100 group-hover:opacity-100"
              >
                <Trash2 size={15} />
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}
