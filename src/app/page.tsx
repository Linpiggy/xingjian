import { FullPlanner } from "@/features/itinerary/full-planner";
import { todayInShanghai } from "@/server/today";

export const dynamic = "force-dynamic";
export default function Page() {
  const startDate = todayInShanghai();
  const mapKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY ?? "";
  const mapsConfigured = Boolean(mapKey && process.env.AMAP_JS_SECURITY_CODE);
  return (
    <FullPlanner startDate={startDate} mapKey={mapKey} mapsConfigured={mapsConfigured} />
  );
}
