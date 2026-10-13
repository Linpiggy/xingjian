import { describe, expect, it } from "vitest";
import { parseYuanFen } from "@/lib/money";

describe("integer fen from user decimal text", () => {
  it("handles decimal amounts without floating point error", () => {
    expect(parseYuanFen("1.10")).toBe(110);
    expect(parseYuanFen("1500.05")).toBe(150005);
    expect(parseYuanFen("0")).toBe(0);
  });
  it("distinguishes empty and invalid values from an explicit zero", () => {
    for (const value of ["", "-1", "1.001", "Infinity", "1e3", "not-a-price"]) {
      expect(parseYuanFen(value)).toBeNull();
    }
  });
});
