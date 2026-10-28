import { test, expect, type Page, type Locator } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

async function setup(page: Page, days = 1, travelers = 1) {
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
  await page.goto("/");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill(String(days));
  await page.getByLabel("同行人数").fill(String(travelers));
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  return () => routes;
}
async function open(page: Page) {
  const details = page.locator(".trip-expense-details");
  if (!(await details.evaluate((element) => (element as HTMLDetailsElement).open))) {
    await details.getByText("查看或补充手动费用估算", { exact: true }).click();
  }
  await details.getByRole("button", { name: "编辑全程费用估算", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "补齐全程费用参考", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function values(dialog: Locator) {
  await dialog.getByLabel("全程餐饮费用（元）", { exact: true }).fill("100.05");
  await dialog.getByLabel("全程住宿费用（元）", { exact: true }).fill("250");
  await dialog.getByLabel("全程市内交通费用（元）", { exact: true }).fill("0");
  await dialog.getByLabel("全程跨城往返费用（元）", { exact: true }).fill("300");
}
for (const [days, travelers] of [
  [1, 1],
  [14, 20],
]) {
  test(`full ${days}-day ${travelers}-person expense estimates preview, cancel, confirm and undo with exact scope and no route calls`, async ({
    page,
  }, testInfo) => {
    const routes = await setup(page, days, travelers);
    let dialog = await open(page);
    await values(dialog);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-full-expense-form-${days}d.png`,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "预览费用估算" }).click();
    const difference = page.getByRole("region", { name: "费用估算差异" });
    await expect(difference).toContainText(travelers === 20 ? "¥2,251.00" : "¥350.05");
    await expect(difference).toContainText("仍未知：门票");
    await expect(difference).toContainText("目标口径未计入");
    await expect(difference).toContainText("明确零元不代表免费");
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
    await page.getByRole("button", { name: "保留原方案" }).click();
    await expect(page.getByRole("region", { name: "全程手动费用估算" })).toContainText(
      "实际支出未知",
    );
    dialog = await open(page);
    await values(dialog);
    await dialog.getByRole("button", { name: "预览费用估算" }).click();
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-full-expense-preview-${days}d.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "确认此项修改" }).click();
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
    await expect(page.getByRole("region", { name: "全程手动费用估算" })).toContainText(
      travelers === 20 ? "¥2,251.00" : "¥350.05",
    );
    await page.getByText("估算来源与记录时间", { exact: true }).click();
    await expect(page.getByRole("region", { name: "全程手动费用估算" })).toContainText(
      "用户记录（UTC）",
    );
    await page.getByRole("button", { name: "撤销上次修改" }).click();
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
    await expect(page.getByRole("region", { name: "全程手动费用估算" })).toContainText(
      "实际支出未知",
    );
    expect(routes()).toBe(0);
  });
}

test("invalid decimal and over-target inputs remain in the modal, require acknowledgement, and Escape restores focus and scrolling", async ({
  page,
}) => {
  const routes = await setup(page);
  let dialog = await open(page);
  await dialog.getByLabel("全程餐饮费用（元）", { exact: true }).fill("0.001");
  await dialog.getByRole("button", { name: "预览费用估算" }).click();
  await expect(dialog.getByRole("alert")).toContainText("最多两位小数");
  await expect(dialog.getByLabel("全程餐饮费用（元）", { exact: true })).toHaveValue(
    "0.001",
  );
  await dialog.getByLabel("全程餐饮费用（元）", { exact: true }).fill("100000");
  await dialog.getByRole("button", { name: "预览费用估算" }).click();
  await expect(dialog.getByRole("alert")).toContainText("知情确认");
  await dialog
    .getByLabel("我已知晓已填估算可能超过预算目标，仍按此记录；不自动增加预算", {
      exact: true,
    })
    .check();
  await dialog.getByRole("button", { name: "预览费用估算" }).click();
  await expect(page.getByRole("region", { name: "费用估算差异" })).toContainText(
    "超过预算目标",
  );
  await page.getByRole("button", { name: "保留原方案" }).click();
  dialog = await open(page);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(
    page.getByRole("button", { name: "编辑全程费用估算", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  expect(routes()).toBe(0);
});

test("expense modal keeps labels visible and keyboard focus local at tablet and narrow widths", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 960, height: 1000 });
  }
  const routes = await setup(page, 14, 20);
  const dialog = await open(page);
  await dialog.getByLabel("全程门票费用（元）", { exact: true }).focus();
  await dialog.getByLabel("全程跨城往返费用（元）", { exact: true }).focus();
  const bounds = await dialog.boundingBox();
  const label = await dialog
    .getByText("全程跨城往返费用（元）", { exact: true })
    .boundingBox();
  expect(label!.y).toBeGreaterThanOrEqual(bounds!.y + 8);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-expense-focus-visible.png`,
    animations: "disabled",
  });
  await dialog.getByRole("heading", { name: "补齐全程费用参考", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "暂不修改费用", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  const controls = dialog.locator(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
  );
  await expect(controls.first()).toBeFocused();
  for (let index = 1; index < (await controls.count()); index += 1) {
    await page.keyboard.press("Tab");
    await expect(controls.nth(index)).toBeFocused();
  }
  await page.keyboard.press("Tab");
  await expect(controls.first()).toBeFocused();
  for (let index = (await controls.count()) - 1; index >= 0; index -= 1) {
    await page.keyboard.press("Shift+Tab");
    await expect(controls.nth(index)).toBeFocused();
    const labelTop = await controls
      .nth(index)
      .evaluate(
        (element) =>
          (
            element as HTMLInputElement | HTMLSelectElement
          ).labels?.[0]?.getBoundingClientRect().top ?? null,
      );
    if (labelTop !== null) {
      expect(labelTop).toBeGreaterThanOrEqual((await dialog.boundingBox())!.y + 8);
    }
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "编辑全程费用估算", exact: true }),
  ).toBeFocused();
  expect(routes()).toBe(0);
});

test("whole generated replacements expose manual expense loss before confirmation and undo restores those records", async ({
  page,
}) => {
  const routes = await setup(page);
  const dialog = await open(page);
  await dialog.getByLabel("全程餐饮费用（元）", { exact: true }).fill("40");
  await dialog.getByRole("button", { name: "预览费用估算" }).click();
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await page.getByRole("button", { name: "调整旅行需求" }).click();
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.getByRole("region", { name: "费用估算差异" })).toContainText(
    "¥40.00／人",
  );
  await expect(page.getByRole("region", { name: "费用估算差异" })).toContainText("未知");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  await page.getByRole("button", { name: "确认使用新方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "4");
  await page.getByText("查看或补充手动费用估算", { exact: true }).click();
  await expect(page.getByRole("region", { name: "全程手动费用估算" })).toContainText(
    "¥40.00",
  );
  expect(routes()).toBe(0);
});
