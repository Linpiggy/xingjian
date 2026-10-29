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

test("map-first panes keep their viewport and isolate native wheel scrolling, with current date and context visible", async ({
  page,
}, testInfo) => {
  await generate(page);
  const banner = page.getByRole("banner");
  const brand = banner.getByRole("link", { name: "行间", exact: true });
  expect((await brand.boundingBox())!.height).toBeLessThanOrEqual(40);
  expect((await banner.boundingBox())!.height).toBeLessThanOrEqual(72);
  const day = page.getByRole("region", { name: "当日完整安排", exact: true });
  if (testInfo.project.name === "desktop") {
    const map = page.getByRole("complementary", { name: "当天路线地图", exact: true });
    const mapBox = (await map.boundingBox())!;
    const dayBox = (await day.boundingBox())!;
    expect(mapBox.x + mapBox.width).toBeLessThan(dayBox.x);
    expect(mapBox.width).toBeGreaterThan(dayBox.width);
    expect(mapBox.height).toBeGreaterThan(300);
    expect(Math.abs(mapBox.height - dayBox.height)).toBeLessThan(2);
    const leftBefore = await map.evaluate((element) => element.scrollTop);
    await page.mouse.move(dayBox.x + dayBox.width / 2, dayBox.y + dayBox.height / 2);
    await page.mouse.wheel(0, 650);
    await expect
      .poll(() => day.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(100);
    expect(await map.evaluate((element) => element.scrollTop)).toBe(leftBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    const heading = (await page.locator(".trip-day-heading").boundingBox())!;
    expect(heading.y).toBeGreaterThanOrEqual(dayBox.y);
    expect(heading.y + heading.height).toBeLessThan(dayBox.y + dayBox.height);
    expect((await map.boundingBox())!.y).toBe(mapBox.y);
    const rightBefore = await day.evaluate((element) => element.scrollTop);
    await page.mouse.move(mapBox.x + mapBox.width / 2, mapBox.y + mapBox.height / 2);
    await page.mouse.wheel(0, 900);
    expect(await day.evaluate((element) => element.scrollTop)).toBe(rightBefore);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
  } else {
    await expect(
      page.getByRole("region", { name: "当天真实地图", exact: true }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "查看地图", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "当天真实地图", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "收起地图", exact: true }).click();
    await expect(
      page.getByRole("region", { name: "当天真实地图", exact: true }),
    ).toHaveCount(0);
  }
  const last = page.getByRole("button", { name: /第 14 天/ });
  await last.click();
  await expect(last).toHaveAttribute("aria-current", "date");
  await expect(last).toBeInViewport();
  if (testInfo.project.name === "desktop") {
    await expect.poll(() => day.evaluate((element) => element.scrollTop)).toBe(0);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-map-first-workspace.png`,
    animations: "disabled",
  });
});

test("long day headings keep measured scroll clearance and narrow layouts return to one main scrolling flow", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await generate(page, true);
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 960, height: 800 });
    await expect
      .poll(() =>
        page
          .locator(".trip-day-content")
          .evaluate((element) =>
            Number.parseFloat(element.style.getPropertyValue("--day-heading-height")),
          ),
      )
      .toBeGreaterThan(70);
    const measured = await page
      .locator(".trip-day-content")
      .evaluate((element) =>
        Number.parseFloat(element.style.getPropertyValue("--day-heading-height")),
      );
    expect(measured).toBeGreaterThanOrEqual(
      Math.floor((await page.locator(".trip-day-heading").boundingBox())!.height),
    );
    await page.setViewportSize({ width: 620, height: 800 });
  } else {
    await page.setViewportSize({ width: 360, height: 800 });
  }
  await expect(page.getByRole("button", { name: "查看地图", exact: true })).toBeVisible();
  const day = page.locator(".trip-day-content");
  const flow = await day.evaluate((element) => ({
    overflow: getComputedStyle(element).overflowY,
    height: element.getBoundingClientRect().height,
  }));
  expect(flow.overflow).toBe("visible");
  expect(flow.height).toBeGreaterThan(800);
  expect(
    (await page
      .getByRole("banner")
      .getByRole("link", { name: "行间", exact: true })
      .boundingBox())!.height,
  ).toBeLessThanOrEqual(40);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-map-first-responsive.png`,
    fullPage: true,
    animations: "disabled",
  });
});
