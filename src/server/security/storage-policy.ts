import type { EditSnapshot } from "@/domain/editing";

export type AmapRetentionPermission = {
  // Trusted operator confirmation, never an HTTP request-body flag.
  evidenceReference: string;
  validUntil: string;
  maxAgeMs: number;
  places: boolean;
  routes: boolean;
};

export class StorageDenied extends Error {
  constructor(
    public readonly code: "retention_unconfirmed" | "data_expired" | "fixture_forbidden",
  ) {
    super("数据来源的保存权限或有效期未确认，未保存此行程。");
    this.name = "StorageDenied";
  }
}

// Call only with a server-validated snapshot. A new plan version must not reset
// a supplier's retention clock; it remains anchored to the original query time.
export function storageExpiry(
  snapshot: EditSnapshot,
  requestedExpiry: Date,
  permission: AmapRetentionPermission | null,
  options: { now: number; allowFixture: boolean },
): Date {
  let deadline = requestedExpiry.getTime();
  if (
    !Number.isFinite(options.now) ||
    !Number.isFinite(deadline) ||
    deadline <= options.now
  ) {
    throw new StorageDenied("data_expired");
  }
  const sources = snapshot.draft.days.flatMap((day) => [
    ...day.items.map((item) => ({
      capability: "places" as const,
      source: item.place.source,
    })),
    ...day.legs.flatMap((leg) =>
      leg.route ? [{ capability: "routes" as const, source: leg.route.source }] : [],
    ),
  ]);
  sources.push(
    ...Object.values(snapshot.intercity.connections).flatMap((connection) =>
      connection ? [{ capability: "routes" as const, source: connection.source }] : [],
    ),
  );
  sources.push(
    ...snapshot.meals.days.flatMap((day) =>
      day.entries.map((entry) => ({
        capability: "places" as const,
        source: entry.place.source,
      })),
    ),
    ...snapshot.meals.connections.flatMap((connection) =>
      connection.route
        ? [{ capability: "routes" as const, source: connection.route.source }]
        : [],
    ),
  );
  for (const { capability, source } of sources) {
    if (source.kind === "fixture") {
      if (!options.allowFixture) {
        throw new StorageDenied("fixture_forbidden");
      }
      continue;
    }
    if (source.kind === "user") {
      continue;
    }
    if (
      !permission ||
      !permission.evidenceReference.trim() ||
      !permission[capability] ||
      !Number.isSafeInteger(permission.maxAgeMs) ||
      permission.maxAgeMs <= 0
    ) {
      throw new StorageDenied("retention_unconfirmed");
    }
    const grantedUntil = Date.parse(permission.validUntil);
    const queriedAt = Date.parse(source.queriedAt);
    if (
      !Number.isFinite(grantedUntil) ||
      !Number.isFinite(queriedAt) ||
      queriedAt > options.now + 60_000
    ) {
      throw new StorageDenied("data_expired");
    }
    deadline = Math.min(deadline, grantedUntil, queriedAt + permission.maxAgeMs);
  }
  if (deadline <= options.now) {
    throw new StorageDenied("data_expired");
  }
  return new Date(deadline);
}
