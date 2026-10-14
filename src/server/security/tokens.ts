import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const guestCookieName = "trip_guest";
export type TokenPurpose = "guest" | "share";

export function newOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

export function validOpaqueToken(value: unknown): value is string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(value)) {
    return false;
  }
  const bytes = Buffer.from(value, "base64url");
  return bytes.length === 32 && bytes.toString("base64url") === value;
}

export function tokenDigest(token: string, purpose: TokenPurpose): string {
  if (!validOpaqueToken(token)) {
    throw new Error("无效访问凭证。");
  }
  return createHash("sha256").update(`travel:${purpose}:`).update(token).digest("hex");
}

export function matchesToken(
  token: unknown,
  expectedDigest: string,
  purpose: TokenPurpose,
): boolean {
  if (!validOpaqueToken(token) || !/^[a-f0-9]{64}$/.test(expectedDigest)) {
    return false;
  }
  const actual = Buffer.from(tokenDigest(token, purpose), "hex");
  return timingSafeEqual(actual, Buffer.from(expectedDigest, "hex"));
}

export function guestCookieOptions(
  expiresAt: Date,
  production: boolean,
  now = Date.now(),
) {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt.getTime() <= now
  ) {
    throw new Error("访问凭证已过期。");
  }
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: production,
    path: "/",
    expires: expiresAt,
  };
}
