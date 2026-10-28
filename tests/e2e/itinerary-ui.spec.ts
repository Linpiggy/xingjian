import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

async function proposal(page: Page, long = false) {
  await page.route("**/api/itineraries", (route) => {
    const plan = fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON()));
    if (long) {
      plan.title = "沿着城市的历史街巷，慢慢走进当地人的文化与生活日常";
      plan.days[0].theme = "历史文化场馆与传统街区之间的一日漫步，留出吃饭和休息的时间";
      plan.days[0].schedule!.items[1].activity.place.name =
        "测试历史文化展览馆与传统工艺体验中心的较长地点名称";
    }
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "result", plan }),
    });
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("2");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
}

test("form sections preserve input and keep the live summary in sync without network queries", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/plan");
  const summary = page.getByRole("complementary", { name: "本次旅行摘要" });
  await page.getByLabel("目的地城市").fill("苏州");
  await page.getByLabel("旅行天数").fill("5");
  await page.getByLabel("同行人数").fill("4");
  await page.getByLabel("预算金额（元）").fill("1234.50");
  await page.getByLabel("预算口径", { exact: true }).selectOption("total");
  await expect(summary).toContainText("苏州");
  await expect(summary).toContainText("1,234.50");
  await expect(summary).toContainText("全体全程预算目标");
  await page.getByRole("button", { name: "偏好与必去", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(
    page.getByRole("button", { name: "偏好与必去", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByRole("button", { name: "特色美食", exact: true }).click();
  await page.getByLabel("必去公共地点").fill("测试公共场馆");
  await expect(summary).toContainText("特色美食");
  await page.getByRole("button", { name: "行程概况", exact: true }).click();
  await expect(page.getByLabel("目的地城市")).toHaveValue("苏州");
  await expect(page.getByLabel("预算金额（元）")).toHaveValue("1234.50");
  await page.getByRole("button", { name: "偏好与必去", exact: true }).click();
  await expect(page.getByLabel("必去公共地点")).toHaveValue("测试公共场馆");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "行程概况", exact: true }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-refined-entry.png`,
    fullPage: true,
  });
  expect(calls).toBe(0);
});

test("validation returns to a hidden invalid field without dropping preferences", async ({
  page,
}) => {
  await page.goto("/plan");
  await page.getByRole("button", { name: "偏好与必去", exact: true }).click();
  await page.getByLabel("必吃菜品").fill("测试菜品");
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.getByLabel("目的地城市")).toBeFocused();
  await expect(
    page.getByRole("button", { name: "行程概况", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByRole("button", { name: "偏好与必去", exact: true }).click();
  await expect(page.getByLabel("必吃菜品")).toHaveValue("测试菜品");
  await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
});

test("place drawer uses native focus trapping, Escape and backdrop dismissal while preserving the plan", async ({
  page,
}, testInfo) => {
  await proposal(page);
  const trigger = page.getByRole("button", { name: "查看测试早餐店的资料", exact: true });
  await trigger.click();
  const dialog = page.getByRole("dialog", { name: "测试早餐店", exact: true });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => getComputedStyle(element).opacity)).toBe("1");
  await expect(
    dialog.getByRole("heading", { name: "测试早餐店", exact: true }),
  ).toBeFocused();
  await expect(dialog).toContainText("未知，不代表免费");
  await expect(dialog).toContainText("测试 fixture，非真实接口结果");
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "关闭地点资料" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByLabel("建议停留（分钟）")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "预览停留调整" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "预览锁定开始时间" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "预览锁定位置" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.locator(".trip-venue-editor > summary")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "返回当天行程" })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "关闭地点资料" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "返回当天行程" })).toBeFocused();
  const box = await dialog.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(testInfo.project.use.viewport!.width);
  if (testInfo.project.name === "mobile") {
    expect(box!.x).toBe(0);
    expect(box!.width).toBe(testInfo.project.use.viewport!.width);
  }
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-refined-place-drawer.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await trigger.click();
  await expect(dialog).toBeVisible();
  await page.mouse.click(3, 3);
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
});

test("refined workspace handles long content, tablet reflow and reduced motion", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 960, height: 1000 });
  }
  await proposal(page, true);
  await expect(
    page.getByRole("button", {
      name: "测试历史文化展览馆与传统工艺体验中心的较长地点名称",
      exact: true,
    }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.getByRole("button", { name: "调整旅行需求" }).click();
  await page.getByRole("button", { name: "偏好与必去", exact: true }).click();
  expect(
    await page
      .locator("#brief-preferences")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await expect(page.getByLabel("必去公共地点")).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
});
