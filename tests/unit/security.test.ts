import { describe, expect, it } from "vitest";
import { createEditState } from "@/domain/editing";
import { fixtureDraft } from "../fixtures/draft";
import {
  guestCookieOptions,
  matchesToken,
  newOpaqueToken,
  tokenDigest,
  validOpaqueToken,
} from "@/server/security/tokens";
import {
  StorageDenied,
  storageExpiry,
  type AmapRetentionPermission,
} from "@/server/security/storage-policy";
import {
  buildShareSnapshot,
  shareSnapshotSchema,
} from "@/server/security/share-snapshot";

const now = Date.parse("2026-10-13T00:10:00.000Z");
const expires = new Date(now + 86_400_000);
const permission: AmapRetentionPermission = {
  evidenceReference: "test-only license confirmation, not real Amap permission",
  validUntil: "2026-10-14T00:00:00.000Z",
  maxAgeMs: 3_600_000,
  places: true,
  routes: true,
};
function snapshot() {
  return createEditState(structuredClone(fixtureDraft()), "security-fixture");
}
function providerSnapshot() {
  const state = snapshot();
  for (const day of state.draft.days) {
    for (const item of day.items) {
      item.place.source.kind = "provider";
    }
    for (const leg of day.legs) {
      if (leg.route) {
        leg.route.source.kind = "provider";
      }
    }
  }
  return state;
}
const options = { now, allowFixture: false };

describe("opaque tokens and cookie flags (not session authorization)", () => {
  it("uses 32 random bytes with canonical base64url encoding and no reused sample token", () => {
    const tokens = Array.from({ length: 32 }, () => newOpaqueToken());
    expect(new Set(tokens).size).toBe(32);
    for (const token of tokens) {
      expect(validOpaqueToken(token)).toBe(true);
      expect(Buffer.from(token, "base64url")).toHaveLength(32);
    }
  });
  it.each([null, "", "short", "A".repeat(43) + "=", "B".repeat(43), "中".repeat(43)])(
    "rejects malformed or noncanonical token %s",
    (token) => {
      expect(validOpaqueToken(token)).toBe(false);
      expect(matchesToken(token, "0".repeat(64), "guest")).toBe(false);
    },
  );
  it("domain-separates owner and share digests, and rejects a different token or bad digest", () => {
    const token = newOpaqueToken();
    const guest = tokenDigest(token, "guest");
    expect(guest).toMatch(/^[a-f0-9]{64}$/);
    expect(guest).not.toBe(tokenDigest(token, "share"));
    expect(matchesToken(token, guest, "guest")).toBe(true);
    expect(matchesToken(token, guest, "share")).toBe(false);
    expect(matchesToken(newOpaqueToken(), guest, "guest")).toBe(false);
    expect(matchesToken(token, "not-a-digest", "guest")).toBe(false);
    expect(() => tokenDigest("short", "guest")).toThrow("无效访问凭证");
  });
  it("uses HttpOnly/SameSite/path and production Secure without exposing a cookie domain", () => {
    expect(guestCookieOptions(expires, true, now)).toEqual({
      httpOnly: true,
      sameSite: "lax",
      secure: true,
      path: "/",
      expires,
    });
    expect(guestCookieOptions(expires, false, now).secure).toBe(false);
    expect(() => guestCookieOptions(new Date(now), true, now)).toThrow("已过期");
    expect(() => guestCookieOptions(new Date(Number.NaN), true, now)).toThrow("已过期");
    expect(() => guestCookieOptions(expires, true, Number.NaN)).toThrow("已过期");
  });
});

describe("source retention defaults deny, not a claimed supplier license", () => {
  it("rejects production fixtures and provider data without trusted confirmation", () => {
    expect(() => storageExpiry(snapshot(), expires, permission, options)).toThrow(
      StorageDenied,
    );
    expect(() => storageExpiry(providerSnapshot(), expires, null, options)).toThrow(
      StorageDenied,
    );
    expect(
      storageExpiry(snapshot(), expires, null, { ...options, allowFixture: true }),
    ).toEqual(expires);
  });
  it("requires each retained capability, not only place permission", () => {
    expect(() =>
      storageExpiry(
        providerSnapshot(),
        expires,
        { ...permission, routes: false },
        options,
      ),
    ).toThrow(StorageDenied);
    expect(() =>
      storageExpiry(
        providerSnapshot(),
        expires,
        { ...permission, places: false },
        options,
      ),
    ).toThrow(StorageDenied);
    expect(() =>
      storageExpiry(
        providerSnapshot(),
        expires,
        { ...permission, evidenceReference: "" },
        options,
      ),
    ).toThrow(StorageDenied);
  });
  it("caps expiry by original data query time and does not extend it on a new version", () => {
    const state = providerSnapshot();
    const queryTime = Date.parse(state.draft.days[0].items[0].place.source.queriedAt);
    const first = storageExpiry(state, expires, permission, options);
    expect(first.getTime()).toBe(queryTime + permission.maxAgeMs);
    state.version += 1;
    expect(
      storageExpiry(state, expires, permission, { ...options, now: now + 60_000 }),
    ).toEqual(first);
    const limited = { ...permission, validUntil: "2026-10-13T00:30:00.000Z" };
    expect(storageExpiry(state, expires, limited, options).toISOString()).toBe(
      limited.validUntil,
    );
  });
  it("rejects expired data, expired confirmation, invalid timestamps and future query times", () => {
    expect(() =>
      storageExpiry(providerSnapshot(), expires, { ...permission, maxAgeMs: 1 }, options),
    ).toThrow(StorageDenied);
    expect(() =>
      storageExpiry(
        providerSnapshot(),
        expires,
        { ...permission, validUntil: new Date(now).toISOString() },
        options,
      ),
    ).toThrow(StorageDenied);
    for (const queriedAt of ["invalid", new Date(now + 120_000).toISOString()]) {
      const state = providerSnapshot();
      state.draft.days[0].items[0].place.source.queriedAt = queriedAt;
      expect(() => storageExpiry(state, expires, permission, options)).toThrow(
        StorageDenied,
      );
    }
    expect(() => storageExpiry(snapshot(), new Date(now), null, options)).toThrow(
      StorageDenied,
    );
  });
  it("does not misclassify user-only input or unknown routes as provider-retained data", () => {
    const state = snapshot();
    for (const day of state.draft.days) {
      for (const item of day.items) {
        item.place.source = {
          kind: "user",
          provider: "user",
          queriedAt: new Date(now).toISOString(),
          coordinateSystem: "GCJ-02",
        };
      }
      for (const leg of day.legs) {
        leg.route = null;
      }
    }
    expect(storageExpiry(state, expires, null, options)).toEqual(expires);
  });
});

describe("strict independent redacted share DTO (not a published share link)", () => {
  it("hides all names by default and never copies private fields or identifiers", () => {
    const state = snapshot();
    const before = structuredClone(state);
    state.draft.input.city = "private-city-sentinel";
    state.draft.days[0].items[0].place.address = "private-address-sentinel";
    const result = buildShareSnapshot(state);
    const json = JSON.stringify(result);
    expect(
      result.days
        .flatMap((day) => day.items)
        .every((item) => item.visibility === "hidden"),
    ).toBe(true);
    for (const text of [
      "private-city-sentinel",
      "private-address-sentinel",
      state.sessionId,
      state.draft.days[0].items[0].place.id,
    ]) {
      expect(json).not.toContain(text);
    }
    for (const field of [
      "location",
      "selections",
      "budget",
      "locks",
      "legs",
      "ownerId",
      "token",
      "name",
    ]) {
      expect(json).not.toContain(`"${field}":`);
    }
    expect(result.fixture).toBe(true);
    expect(state.budget).toEqual(before.budget);
    expect(state.version).toBe(before.version);
    expect(
      shareSnapshotSchema.safeParse({ ...result, ownerId: "not-allowed" }).success,
    ).toBe(false);
  });
  it("shows only explicitly approved public names, never a user point even when allowlisted", () => {
    const state = providerSnapshot();
    const first = state.draft.days[0].items[0].place;
    const second = state.draft.days[0].items[1].place;
    second.name = "private-user-location-sentinel";
    second.source = {
      kind: "user",
      provider: "user",
      queriedAt: new Date(now).toISOString(),
      coordinateSystem: "GCJ-02",
    };
    const result = buildShareSnapshot(state, [first.id, second.id, "invented-id"]);
    expect(result.days[0].items[0].label).toBe(first.name);
    expect(result.days[0].items[0].queriedAt).toBe(first.source.queriedAt);
    expect(result.days[0].items[1].visibility).toBe("hidden");
    expect(result.days[0].items[1].queriedAt).toBeNull();
    expect(JSON.stringify(result)).not.toContain(second.name);
    expect(result.fixture).toBe(false);
  });
  it("preserves unknown/overflow times, conflict counts and infeasible status rather than certifying feasibility", () => {
    const state = snapshot();
    state.draft.status = "infeasible";
    state.draft.days[0].issues = ["private-conflict-detail"];
    state.draft.days[0].items[0].startMinute = null;
    state.draft.days[0].items[1].endMinute = 1500;
    const result = buildShareSnapshot(state);
    expect(result.status).toBe("infeasible");
    expect(result.days[0].issueCount).toBe(1);
    expect(result.days[0].items[0].startMinute).toBeNull();
    expect(result.days[0].items[1].endMinute).toBe(1500);
    expect(JSON.stringify(result)).not.toContain("private-conflict-detail");
    expect(result.notice).toContain("仍须核实");
  });
});
