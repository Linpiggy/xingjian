import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { RecentTrips } from "@/features/trip/recent-trips";

export const metadata: Metadata = {
  title: "我的行程 · 行间",
};

export default function TripsPage() {
  return (
    <>
      <SiteHeader />
      <main id="main" className="mx-auto max-w-7xl px-5 pb-20 pt-8 sm:px-8">
        <h1 className="font-display text-4xl text-ink">我的行程</h1>
        <p className="mb-8 mt-2 text-sm text-ink-soft">
          行程保存在当前浏览器中，最多保留最近 12 份。
        </p>
        <RecentTrips full />
      </main>
    </>
  );
}
