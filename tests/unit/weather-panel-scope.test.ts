import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("weather panel placement", () => {
  it("is rendered inside the itinerary book, not a separate manual workspace", () => {
    const book = readFileSync("src/features/itinerary/itinerary-book.tsx", "utf8");
    expect(book).toContain('from "./weather-panel"');
    const panel = readFileSync("src/features/itinerary/weather-panel.tsx", "utf8");
    expect(panel).toContain("当天天气");
  });
});
