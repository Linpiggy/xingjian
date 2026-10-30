import { test, expect } from "@playwright/test";
import { searchFixture } from "./fixtures";

// No SDK or supplier calls: simulate the container positioning a map SDK may set.
test("map container retains width and height after SDK positioning override", async ({
  page,
}) => {
  await page.goto("/plan");
  await searchFixture(page);
  await page.getByRole("button", { name: "地图选点", exact: true }).click();
  const region = page.getByRole("region", { name: "自定义点选地图" });
  const canvas = region.locator(".map-canvas");
  await canvas.evaluate((element) => {
    element.style.position = "relative";
    element.classList.add("amap-container");
  });
  const dimensions = await canvas.evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
  }));
  expect(dimensions.width).toBeGreaterThan(100);
  expect(dimensions.height).toBeGreaterThan(100);
});
