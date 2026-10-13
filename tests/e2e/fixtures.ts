import { expect, type Page } from "@playwright/test";
import { places } from "../fixtures/draft";

export async function searchFixture(page: Page) {
  await page.route("**/api/places?*", (route) => route.fulfill({ json: { places } }));
  await page.getByLabel("搜索地点名称").fill("测试");
  await page.getByRole("button", { name: "搜索地点", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `添加${places[0].name}`, exact: true }),
  ).toBeVisible();
}
export async function addFixturePlaces(page: Page) {
  await searchFixture(page);
  for (const place of places) {
    await page.getByRole("button", { name: `添加${place.name}`, exact: true }).click();
  }
}
export function fixtureRecommendations() {
  return {
    recommendations: places.slice(1, 3).map((place) => ({
      place,
      selection: { kind: "amap", poiId: place.id, keyword: "博物馆" },
      reason: "AI 分析：测试 fixture，验证兴趣推荐交互。",
    })),
    model: "fixture-model",
    queriedAt: places[0].source.queriedAt,
  };
}
