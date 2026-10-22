import { Planner } from "@/features/planner/planner";
import { todayInShanghai } from "@/server/today";

export const dynamic = "force-dynamic";
export default function ManualPage() {
  const mapKey = process.env.NEXT_PUBLIC_AMAP_JS_KEY ?? "";
  const mapsConfigured = Boolean(mapKey && process.env.AMAP_JS_SECURITY_CODE);
  return (
    <Planner
      startDate={todayInShanghai()}
      mapKey={mapKey}
      mapsConfigured={mapsConfigured}
    />
  );
}
