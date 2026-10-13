import { afterEach, describe, expect, it, vi } from "vitest";
import { requestJson } from "@/lib/client-api";
import { placesResponseSchema } from "@/lib/contracts";
import { places } from "../fixtures/draft";

afterEach(() => vi.unstubAllGlobals());
describe("typed browser JSON requests (mock only)", () => {
  it("accepts schema-valid fixture data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ places })),
    );
    expect((await requestJson("/api/places", placesResponseSchema)).places).toHaveLength(
      4,
    );
  });
  it("rejects malformed success responses without fabricating places", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ places: [{ id: "missing-fields" }] })),
    );
    await expect(requestJson("/api/places", placesResponseSchema)).rejects.toThrow(
      "服务响应格式异常",
    );
  });
  it("uses the public error message on server failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ message: "测试服务未配置。" }, { status: 503 })),
    );
    await expect(requestJson("/api/places", placesResponseSchema)).rejects.toThrow(
      "测试服务未配置",
    );
  });
});
