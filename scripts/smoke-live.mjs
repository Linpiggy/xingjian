// Explicit opt-in: one application POST, 3 place queries + 1 walking query.
// This script is never part of npm run check or E2E; it consumes real provider quota.
import { existsSync, writeFileSync } from "node:fs";

const evidencePath = `docs/evidence/app-smoke-${new Date().toISOString().slice(0, 10)}.json`;
if (existsSync(evidencePath)) {
  throw new Error(
    "Today's evidence already exists. Review it instead of repeating paid queries.",
  );
}
const base = "http://127.0.0.1:3000";
const input = {
  city: "杭州",
  startDate: "2026-10-17",
  dayCount: 2,
  travelers: 2,
  budgetPerPersonFen: 150000,
  keywords: ["浙江省博物馆孤山馆", "西湖博物馆", "浙江美术馆"],
  stayMinutes: 90,
  bufferMinutes: 15,
};
const started = Date.now();
const response = await fetch(`${base}/api/plans`, {
  method: "POST",
  headers: { Origin: base, "Content-Type": "application/json" },
  body: JSON.stringify(input),
  signal: AbortSignal.timeout(60_000),
});
if (!response.ok) {
  throw new Error(
    `Application smoke failed with HTTP ${response.status}; inspect the app's sanitized error state.`,
  );
}
const data = await response.json();
const draft = data.draft;
if (!draft || draft.status !== "unverified" || draft.days?.length !== 2) {
  throw new Error("Draft state or day grouping is invalid.");
}
const places = draft.days.flatMap((day) => day.items.map((item) => item.place));
const legs = draft.days.flatMap((day) => day.legs);
if (
  places.length !== 3 ||
  places.some(
    (p) => p.source?.kind !== "provider" || p.source.coordinateSystem !== "GCJ-02",
  )
) {
  throw new Error("Real provider provenance or place count was not verified.");
}
if (
  legs.length !== 1 ||
  !legs[0].route ||
  legs[0].route.seconds == null ||
  !legs[0].route.segments.length
) {
  throw new Error("Real walking time and route geometry were not verified.");
}
const leg = legs[0].route;
const summary = {
  kind: "real_application_smoke",
  checkedAt: new Date().toISOString(),
  applicationEndpoint: "POST /api/plans",
  httpStatus: response.status,
  durationMs: Date.now() - started,
  inputSummary: { city: input.city, dayCount: input.dayCount, keywords: input.keywords },
  providerCallsExpected: { placeSearch: 3, walking: 1 },
  placeCount: places.length,
  routeCount: legs.length,
  draftStatus: draft.status,
  walking: {
    meters: leg.meters,
    seconds: leg.seconds,
    geometrySegments: leg.segments.length,
    coordinateSystem: leg.source.coordinateSystem,
  },
  limitations: [
    "Not a JS basemap test",
    "No weather, meals, opening, reservations, return transport or full budget verification",
    "No raw merchant data or credentials retained",
    "City is a test example, not a confirmed MVP city",
  ],
};
writeFileSync(evidencePath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify({
    result: "PASS",
    evidencePath,
    places: places.length,
    routes: legs.length,
    meters: leg.meters,
    seconds: leg.seconds,
    segments: leg.segments.length,
  }),
);
