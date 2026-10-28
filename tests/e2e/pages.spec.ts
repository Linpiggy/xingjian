import { test, expect } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

test("home, planning and current itinerary are distinct routes with keyboard navigation and no automatic requests", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/explore");
  await expect(
    page.getByRole("heading", { name: /你的下一站，\s*值得好好期待。/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "首页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-travel-home.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".travel-paper-front")
      .evaluate((element) => getComputedStyle(element).animationName),
  ).toBe("none");
  await page.setViewportSize({
    width: testInfo.project.name === "desktop" ? 960 : 360,
    height: 1000,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const current = page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "当前行程", exact: true });
  await current.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/itinerary$/);
  await expect(page.getByRole("heading", { name: "还没有当前行程" })).toBeVisible();
  await page.getByRole("link", { name: "新建旅行规划", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByLabel("目的地城市")).toBeVisible();
  expect(calls).toBe(0);
});

test("leaving an edited brief requires explicit discard and never starts generation", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("尚未提交的城市");
  const home = page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "首页", exact: true });
  page.once("dialog", (dialog) => dialog.dismiss());
  await home.click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByLabel("目的地城市")).toHaveValue("尚未提交的城市");
  page.once("dialog", (dialog) => dialog.accept());
  await home.click();
  await expect(page).toHaveURL(/\/explore$/);
  expect(calls).toBe(0);
});

test("new plan moves to the itinerary route, keeps the proposal across soft navigation and does not pretend a refresh saved it", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        type: "result",
        plan: fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON())),
      }),
    });
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("1");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page).toHaveURL(/\/itinerary$/);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await expect(
    page.getByRole("heading", { name: "在城市的文化与烟火之间" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "首页", exact: true })
    .click();
  await expect(page).toHaveURL(/\/explore$/);
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "当前行程", exact: true })
    .click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.getByRole("button", { name: "调整旅行需求" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByLabel("目的地城市")).toHaveValue("测试城市");
  await page.getByRole("button", { name: "返回当前方案" }).click();
  await expect(page).toHaveURL(/\/itinerary$/);
  expect(calls).toBe(1);
  await page
    .getByRole("button", { name: "查看测试文化场馆1的资料", exact: true })
    .click();
  await page.getByLabel("建议停留（分钟）").fill("45");
  await page.getByRole("button", { name: "预览停留调整" }).click();
  await expect(page.getByRole("region", { name: "活动修改差异" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "首页", exact: true })
    .click();
  await page.getByRole("link", { name: "开始规划", exact: true }).click();
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("尚未确认的预览");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "返回当前方案" }).click();
  await expect(page.getByRole("region", { name: "活动修改差异" })).toBeVisible();
  await page.getByRole("button", { name: "保留原方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.reload();
  await expect(page.getByRole("heading", { name: "还没有当前行程" })).toBeVisible();
  await expect(page.getByText(/刷新会清空/)).toBeVisible();
  await page.goto("/");
  await expect(page.getByLabel("目的地城市")).toBeVisible();
  expect(calls).toBe(1);
});
