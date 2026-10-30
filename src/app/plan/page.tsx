import { PlanningWorkspace } from "@/features/itinerary/planning-workspace";
import { todayInShanghai } from "@/server/today";

export const dynamic = "force-dynamic";
export const metadata = { title: "规划工作台 | 行间" };
export default function PlanPage() {
  const mapKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY ?? "";
  return (
    <PlanningWorkspace
      startDate={todayInShanghai()}
      mapKey={mapKey}
      mapsConfigured={Boolean(mapKey && process.env.AMAP_JS_SECURITY_CODE)}
    />
  );
}
