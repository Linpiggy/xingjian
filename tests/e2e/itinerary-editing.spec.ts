import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

async function setup(page: Page, days = 2) {
  let routes = 0;
  await page.route("**/api/routes", (route) => {
    routes += 1;
    return route.abort();
  });
  await page.route("**/api/itineraries", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        type: "result",
        plan: fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON())),
      }),
    }),
  );
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill(String(days));
  await page.getByLabel("同行人数").fill("20");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  return () => routes;
}
for (const days of [1, 14]) {
  test(`activity duration edits preserve day ${days}, preview, cancel, confirm and undo without route queries`, async ({
    page,
  }, testInfo) => {
    const routes = await setup(page, days);
    if (days === 14) {
      await page.getByRole("tab", { name: /第 14 天/ }).click();
    }
    const name = `测试文化场馆${(days - 1) * 2 + 1}`;
    const trigger = page.getByRole("button", { name: `查看${name}的资料`, exact: true });
    const activity = page
      .getByRole("article")
      .filter({ has: page.getByRole("button", { name, exact: true }) });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name, exact: true });
    await dialog.getByLabel("建议停留（分钟）").fill("14");
    await dialog.getByRole("button", { name: "预览停留调整" }).click();
    await expect(dialog.getByRole("alert")).toContainText("15—240");
    await dialog.getByLabel("建议停留（分钟）").fill("90");
    await dialog.getByRole("button", { name: "预览停留调整" }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.locator("#trip-review-heading")).toBeFocused();
    await expect(page.getByRole("region", { name: "活动修改差异" })).toContainText(
      /60\s*→\s*90/,
    );
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
    await expect(page.getByRole("region", { name: "当日完整安排" })).toContainText(
      `第${days}天`,
    );
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-full-activity-preview-${days}d.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "确认此项修改" }).click();
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
    await expect(activity).toContainText(/建议\s*90\s*分钟/);
    await trigger.click();
    await page.getByRole("dialog", { name }).getByLabel("建议停留（分钟）").fill("120");
    await page.getByRole("button", { name: "预览停留调整" }).click();
    await page.getByRole("button", { name: "保留原方案" }).click();
    await expect(activity).toContainText(/建议\s*90\s*分钟/);
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
    await page.getByRole("button", { name: "撤销上次修改" }).click();
    await expect(activity).toContainText(/建议\s*60\s*分钟/);
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
    expect(routes()).toBe(0);
  });
}

test("fourteen-day position locks preview and undo explicitly and generated plans cannot clear them", async ({
  page,
}, testInfo) => {
  const routes = await setup(page, 14);
  await page.getByRole("tab", { name: /第 14 天/ }).click();
  const trigger = page.getByRole("button", {
    name: "查看测试文化场馆27的资料",
    exact: true,
  });
  await trigger.click();
  await page.getByRole("button", { name: "预览锁定位置", exact: true }).click();
  await expect(page.getByRole("region", { name: "活动修改差异" })).toContainText(
    "锁定此地点的日期与次序",
  );
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.getByRole("button", { name: "保留原方案" }).click();
  await expect(page.locator(".trip-position-lock")).toHaveCount(0);
  await trigger.click();
  await page.getByRole("button", { name: "预览锁定位置", exact: true }).click();
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-position-lock")).toContainText("位置已锁");
  if (testInfo.project.name === "desktop") {
    const handle = page.getByRole("button", {
      name: "调整测试文化场馆27的位置",
      exact: true,
    });
    await expect(handle).toBeDisabled();
    await expect(handle).toHaveAttribute("draggable", "false");
  }
  await expect(page.locator(".trip-time-lock")).toHaveCount(0);
  await trigger.click();
  await expect(page.getByRole("dialog")).toContainText(
    "位置锁保留此地点、日期与次序，不固定开始时间",
  );
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-full-position-lock.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "调整旅行需求" }).click();
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await page.getByRole("button", { name: "确认使用新方案" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("位置锁");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  await page.getByRole("button", { name: "返回当前方案" }).click();
  await page.getByRole("tab", { name: /第 14 天/ }).click();
  await expect(page.locator(".trip-position-lock")).toHaveCount(1);
  await trigger.click();
  await page.getByRole("button", { name: "预览解除位置锁" }).click();
  await expect(page.getByRole("region", { name: "活动修改差异" })).toContainText(
    "明确解除地点位置锁",
  );
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-position-lock")).toHaveCount(0);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  await expect(page.locator(".trip-position-lock")).toHaveCount(1);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "4");
  expect(routes()).toBe(0);
});

test("time locks block conflicting duration edits and only explicit unlock previews may release them", async ({
  page,
}) => {
  const routes = await setup(page);
  const lunch = page.getByRole("button", { name: "查看测试午餐店的资料", exact: true });
  await lunch.click();
  await page.getByRole("button", { name: "预览锁定开始时间" }).click();
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-time-lock")).toContainText("11:45");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  await page
    .getByRole("button", { name: "查看测试文化场馆1的资料", exact: true })
    .click();
  await page.getByLabel("建议停留（分钟）").fill("90");
  await page.getByRole("button", { name: "预览停留调整" }).click();
  await expect(page.getByRole("button", { name: "确认此项修改" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "新方案确认" })).toContainText(
    "请先解决行程冲突",
  );
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  await page.getByRole("button", { name: "保留原方案" }).click();
  await lunch.click();
  await page.getByRole("button", { name: "预览解除时间锁" }).click();
  await expect(page.getByRole("region", { name: "活动修改差异" })).toContainText(
    "明确解除开始时间锁",
  );
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-time-lock")).toHaveCount(0);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  await expect(page.locator(".trip-time-lock")).toContainText("11:45");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "4");
  expect(routes()).toBe(0);
});
