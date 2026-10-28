import { FullPlanner } from "@/features/itinerary/full-planner";
import { todayInShanghai } from "@/server/today";

export const dynamic = "force-dynamic";
export const metadata = { title: "新建规划 | 行间" };
export default function NewPlanPage() {
  const mapKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY ?? "";
  return (
    <FullPlanner
      key="new-plan"
      view="new"
      startDate={todayInShanghai()}
      mapKey={mapKey}
      mapsConfigured={Boolean(mapKey && process.env.AMAP_JS_SECURITY_CODE)}
    />
  );
}
