import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

async function generate(page: Page, long = false) {
  await page.route("**/api/itineraries", (route) => {
    const plan = fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON()));
    if (long) {
      plan.title = "沿着城市的历史街巷，慢慢走进当地人的文化与生活日常";
      plan.days[0].theme = "历史文化场馆与传统街区之间的一日漫步，留出吃饭和休息的时间";
    }
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "result", plan }),
    });
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("14");
  await page.getByLabel("同行人数").fill("20");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案", exact: true }).click();
  await expect(page.locator(".unified-planner")).toHaveAttribute(
    "data-plan-revision",
    "1",
  );
}

test("map comes before daily planning on both screens and native wheel moves the single document, not nested panes", async ({
  page,
}, testInfo) => {
  await generate(page);
  const banner = page.getByRole("banner");
  expect(
    (await banner.getByRole("link", { name: "行间", exact: true }).boundingBox())!.height,
  ).toBeLessThanOrEqual(40);
  expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(72);
  const map = page.getByRole("complementary", { name: "当天路线地图", exact: true });
  const day = page.getByRole("region", { name: "当日完整安排", exact: true });
  await expect(
    page.getByRole("region", { name: "当天真实地图", exact: true }),
  ).toBeVisible();
  const mapBox = (await map.boundingBox())!;
  const dayBox = (await day.boundingBox())!;
  expect(mapBox.y + mapBox.height).toBeLessThanOrEqual(dayBox.y);
  expect(Math.abs(mapBox.x - dayBox.x)).toBeLessThan(2);
  expect(Math.abs(mapBox.width - dayBox.width)).toBeLessThan(2);
  for (const section of [map, day]) {
    expect(await section.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
      "visible",
    );
    expect(await section.evaluate((element) => element.scrollTop)).toBe(0);
  }
  await page.mouse.move(testInfo.project.name === "mobile" ? 190 : 720, 650);
  const before = await page.evaluate(() => window.scrollY);
  await page.mouse.wheel(0, 600);
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(before);
  expect(await day.evaluate((element) => element.scrollTop)).toBe(0);
  expect(await map.evaluate((element) => element.scrollTop)).toBe(0);
  const dates = page.getByRole("navigation", { name: "选择行程日期", exact: true });
  await expect
    .poll(() => dates.evaluate((element) => element.getBoundingClientRect().top))
    .toBe(0);
  await page.getByRole("tab", { name: /第 14 天/ }).click();
  await expect(page.getByRole("tab", { name: /第 14 天/ })).toHaveAttribute(
    "aria-current",
    "date",
  );
  await expect(page.getByRole("tab", { name: /第 14 天/ })).toBeInViewport();
  await expect(day).toContainText("第14天");
  await expect
    .poll(async () => {
      const route = (await map.boundingBox())!;
      const navigation = (await dates.boundingBox())!;
      return route.y - navigation.y - navigation.height;
    })
    .toBeGreaterThanOrEqual(11);
  await page.getByRole("button", { name: "查看当天安排", exact: true }).click();
  await expect(day.getByRole("heading", { level: 2 }).first()).toBeFocused();
  await expect
    .poll(async () => {
      const heading = (await page.locator(".trip-day-heading").boundingBox())!;
      const navigation = (await dates.boundingBox())!;
      return heading.y - navigation.y - navigation.height;
    })
    .toBeGreaterThanOrEqual(11);
  await expect(
    page.getByRole("button", { name: "查看当天重点：测试文化场馆27", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-vertical-daily-plan.png`,
    animations: "disabled",
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-vertical-map-first.png`,
    animations: "disabled",
  });
});

test("long titles and changing viewport keep map-first order and readable document flow without a hidden mobile map", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await generate(page, true);
  for (const width of testInfo.project.name === "desktop" ? [960, 620] : [390, 360]) {
    await page.setViewportSize({ width, height: 800 });
    const map = page.getByRole("complementary", { name: "当天路线地图", exact: true });
    const day = page.getByRole("region", { name: "当日完整安排", exact: true });
    const first = (await map.boundingBox())!;
    const second = (await day.boundingBox())!;
    expect(first.y + first.height).toBeLessThanOrEqual(second.y);
    expect(first.width).toBeGreaterThan(280);
    expect(await day.evaluate((element) => getComputedStyle(element).overflowY)).toBe(
      "visible",
    );
    expect(second.height).toBeGreaterThan(800);
    await expect(
      page.getByRole("region", { name: "当天真实地图", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
  }
  await page.getByRole("button", { name: "查看当天安排", exact: true }).click();
  await expect(page.locator(".trip-day-heading h2")).toBeInViewport();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-vertical-responsive.png`,
    fullPage: true,
    animations: "disabled",
  });
});
