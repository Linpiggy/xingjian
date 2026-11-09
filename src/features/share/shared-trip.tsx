/**
 * 分享页：从 URL # 片段解码行程（不会发到服务器），只读展示；可一键存为自己的行程继续编辑。
 */
"use client";

import { Download, Loader2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { SiteHeader } from "@/components/site-header";
import { MapOverlay } from "@/features/map/map-overlay";
import { DayChapter } from "@/features/trip/day-chapter";
import { TripCover } from "@/features/trip/trip-cover";
import { TripOverview } from "@/features/trip/trip-overview";
import { TripTips } from "@/features/trip/trip-tips";
import type { Citation, Trip, TripRequest } from "@/lib/schema";
import { decodeShare } from "@/lib/share";
import { useTrips } from "@/store/trips";

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; request: TripRequest; trip: Trip };

export function SharedTrip() {
  const router = useRouter();
  const importTrip = useTrips((store) => store.importSample);
  const [state, setState] = useState<State>({ status: "loading" });
  const [mapDay, setMapDay] = useState<number | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const payload = window.location.hash.slice(1);
    if (!payload) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- 只在挂载时读取一次 URL
      setState({ status: "error", message: "链接里没有行程内容，可能复制不完整。" });
      return;
    }
    decodeShare(payload)
      .then(({ request, trip }) => setState({ status: "ready", request, trip }))
      .catch(() =>
        setState({ status: "error", message: "分享链接无效或已损坏，可能复制不完整。" }),
      );
  }, []);

  const citations = useMemo(
    () =>
      new Map<string, Citation>(
        state.status === "ready"
          ? state.trip.citations.map((item) => [item.id, item])
          : [],
      ),
    [state],
  );

  if (state.status !== "ready") {
    return (
      <>
        <SiteHeader />
        <main id="main" className="mx-auto max-w-xl px-5 py-24 text-center">
          {state.status === "loading" ? (
            <p className="flex items-center justify-center gap-2 text-ink-soft">
              <Loader2 size={16} className="animate-spin" aria-hidden />
              正在打开分享的手册…
            </p>
          ) : (
            <>
              <h1 className="font-display text-3xl">打不开这份手册</h1>
              <p className="mt-3 text-ink-soft" role="alert">
                {state.message}
              </p>
              <Link
                href="/"
                className="mt-8 inline-flex h-11 items-center rounded-lg bg-pine px-5 text-white"
              >
                自己规划一份
              </Link>
            </>
          )}
        </main>
      </>
    );
  }

  const { trip, request } = state;
  const save = () => {
    const id = importTrip(request, trip, false);
    router.push(`/plan/${id}`);
  };

  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-7xl px-4 pb-24 sm:px-8">
        <div className="no-print mb-4 flex flex-col gap-3 rounded-lg border border-line bg-card px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-ink-soft">
            这是朋友分享给你的旅行手册（只读）。存到自己的行程后，可以修改、锁定或让 AI
            调整。
          </p>
          <button
            type="button"
            onClick={save}
            className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-pine px-4 text-sm font-medium text-white hover:bg-pine-deep"
          >
            <Download size={15} aria-hidden />
            存到我的行程
          </button>
        </div>
        <TripCover trip={trip} request={request} />
        <div className="mx-auto mt-10 max-w-[960px]">
          <TripOverview trip={trip} request={request} />
          {trip.days.map((day) => (
            <DayChapter
              key={day.day}
              day={day}
              citations={citations}
              activeId={activeId}
              onFocus={setActiveId}
              hotel={trip.hotel}
              onExpandMap={setMapDay}
            />
          ))}
          <section id="tips" className="scroll-mt-24 pt-16">
            <TripTips trip={trip} citations={citations} />
          </section>
        </div>
      </main>
      <MapOverlay
        days={trip.days}
        hotel={trip.hotel}
        day={mapDay}
        onDayChange={setMapDay}
        onClose={() => setMapDay(null)}
        onLocate={(id) => {
          setMapDay(null);
          setActiveId(id);
          requestAnimationFrame(() =>
            document
              .getElementById(`stop-${id}`)
              ?.scrollIntoView({ behavior: "smooth", block: "center" }),
          );
        }}
      />
    </>
  );
}
