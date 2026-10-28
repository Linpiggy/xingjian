import { FullPlanner } from "@/features/itinerary/full-planner";
import { todayInShanghai } from "@/server/today";

export const dynamic = "force-dynamic";
export const metadata = { title: "当前行程 | 行间" };
export default function ItineraryPage() {
  const mapKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY ?? "";
  return (
    <FullPlanner
      key="current-itinerary"
      view="itinerary"
      startDate={todayInShanghai()}
      mapKey={mapKey}
      mapsConfigured={Boolean(mapKey && process.env.AMAP_JS_SECURITY_CODE)}
    />
  );
}
