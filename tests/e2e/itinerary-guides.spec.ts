import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

async function setup(page: Page, legacy = false) {
  let routeCalls = 0;
  await page.route("**/api/routes", (route) => {
    routeCalls += 1;
    return route.abort();
  });
  await page.route("**/api/itineraries", (route) => {
    const plan = fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON()));
    if (legacy) {
      for (const day of plan.days) {
        for (const recommendation of day.recommendations) {
          delete recommendation.guide;
        }
      }
    }
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "result", plan }),
    });
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill(legacy ? "1" : "14");
  await page.getByLabel("同行人数").fill("20");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  return () => routeCalls;
}

test("rich visit and meal guidance stays explicitly AI advice through detail, edit and undo at day fourteen", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const routes = await setup(page);
  await page.getByRole("button", { name: /第 14 天/ }).click();
  await expect(page.locator(".trip-cover-facts")).toContainText("测试城市");
  await expect(page.locator(".trip-experience")).toHaveCount(5);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-rich-proposal.png`,
    animations: "disabled",
  });
  const trigger = page.getByRole("button", {
    name: "查看测试文化场馆27的资料",
    exact: true,
  });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "测试文化场馆27", exact: true });
  const guide = dialog.getByRole("region", { name: "AI 游玩建议", exact: true });
  await expect(guide).toContainText("非已核实地点介绍");
  await expect(guide).toContainText("文化线索");
  await expect(guide).toContainText("体验重点");
  await expect(guide).toContainText("摄影前核实现场规定");
  await expect(guide).toContainText("出发前再确认");
  await expect(guide).toContainText("不是商家、景区或评论证据");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-rich-place-guide.png`,
    animations: "disabled",
  });
  await dialog.getByLabel("建议停留（分钟）").fill("45");
  await dialog.getByRole("button", { name: "预览停留调整" }).click();
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  await trigger.click();
  await expect(guide).toContainText("文化线索");
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
  await page.getByRole("button", { name: "查看测试早餐店的资料", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "AI 用餐建议", exact: true }),
  ).toContainText("过敏原处理");
  await expect(page.getByRole("dialog")).toContainText("未知，不代表免费");
  await page.keyboard.press("Escape");
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "查看地图" }).click();
  }
  await expect(page.locator(".route-map-legend")).toContainText("4/4 段含轨迹");
  await expect(page.locator(".route-map-legend")).toContainText("缺失轨迹不以直线补连");
  await expect(page.getByRole("button", { name: "查看全日路线" })).toHaveCount(0);
  if (testInfo.project.name === "mobile") {
    await page.getByRole("button", { name: "查看当天安排", exact: true }).click();
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.getByRole("button", { name: /第 1 天/ }).click();
  expect(
    await page
      .locator(".trip-timeline > li")
      .first()
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await page.setViewportSize({
    width: testInfo.project.name === "desktop" ? 960 : 360,
    height: 1000,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  expect(routes()).toBe(0);
  expect(errors).toEqual([]);
});

test("legacy plans keep their real missing-content state rather than fabricating a guide", async ({
  page,
}) => {
  const routes = await setup(page, true);
  await expect(page.locator(".trip-experience")).toHaveCount(0);
  await page
    .getByRole("button", { name: "查看测试文化场馆1的资料", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("本次安排");
  await expect(
    page.getByRole("region", { name: "AI 游玩建议", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("建议停留（分钟）")).toHaveValue("60");
  await page.keyboard.press("Escape");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  expect(routes()).toBe(0);
});
