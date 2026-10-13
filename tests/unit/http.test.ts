import { describe, expect, it } from "vitest";
import { api, json, readBody, requireSameOrigin } from "@/server/http";
import { ProviderError } from "@/server/providers/errors";
import { POST } from "@/app/api/plans/route";

describe("HTTP boundaries", () => {
  it("rejects cross-origin POST before calling any provider", async () => {
    const response = await POST(
      new Request("http://localhost/api/plans", {
        method: "POST",
        headers: { origin: "https://evil.invalid", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe("invalid_request");
  });
  it("rejects invalid JSON and oversized bodies", async () => {
    for (const body of ["{", JSON.stringify("x".repeat(17000))]) {
      const response = await api(async () =>
        json(
          await readBody(
            new Request("http://localhost/api/plans", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body,
            }),
          ),
        ),
      );
      expect(response.status).toBe(400);
    }
  });
  it("accepts a same-origin request", () => {
    expect(() =>
      requireSameOrigin(
        new Request("http://localhost/api/plans", {
          headers: { origin: "http://localhost" },
        }),
      ),
    ).not.toThrow();
  });
  it("accepts only same-port loopback aliases normalized by Next.js", () => {
    const request = new Request("http://localhost:3000/api/plans", {
      headers: { origin: "http://127.0.0.1:3000" },
    });
    expect(() => requireSameOrigin(request)).not.toThrow();
  });
  it("rejects foreign hosts, different ports, schemes and invalid origins", () => {
    for (const origin of [
      "http://127.0.0.1:3001",
      "https://127.0.0.1:3000",
      "http://evil.invalid:3000",
      "http://localhost:3000/unexpected-path",
      "null",
    ]) {
      const request = new Request("http://localhost:3000/api/plans", {
        headers: { origin },
      });
      expect(() => requireSameOrigin(request)).toThrow();
    }
  });
  it("sanitizes unexpected errors", async () => {
    const response = await api(async () => {
      throw new Error("private-key-fixture");
    });
    expect(await response.text()).not.toContain("private-key-fixture");
  });
  it("separates unconfigured, quota and empty-result errors", async () => {
    for (const [error, status] of [
      [new ProviderError("not_configured", "fixture"), 503],
      [new ProviderError("unavailable", "fixture", "rate_limited"), 429],
      [new ProviderError("unavailable", "fixture", "no_place"), 422],
    ] as const) {
      const response = await api(async () => {
        throw error;
      });
      expect(response.status).toBe(status);
      expect(response.headers.get("cache-control")).toBe("no-store");
    }
  });
});
