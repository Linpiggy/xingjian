import { test, expect, type Page, type Locator } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

async function setup(page: Page, days = 1, travelers = 1, longName?: string) {
  let requests = 0;
  await page.route("**/api/routes", (route) => {
    requests += 1;
    return route.abort();
  });
  await page.route("**/api/itineraries", (route) => {
    const plan = fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON()));
    if (longName) {
      plan.days.at(-1)!.schedule!.items[1].activity.place.name = longName;
    }
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "result", plan }),
    });
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill(String(days));
  await page.getByLabel("同行人数").fill(String(travelers));
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  return () => requests;
}
async function editor(page: Page, name = "测试文化场馆1") {
  await page.getByRole("button", { name: `查看${name}的资料`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name, exact: true });
  await dialog.getByText("编辑营业与预约记录", { exact: true }).click();
  return dialog;
}
async function opening(dialog: Locator) {
  await dialog.getByLabel("录入景点营业与预约", { exact: true }).check();
  const date = await dialog.getByLabel("景点规则适用日期").inputValue();
  await dialog.getByLabel("景点营业状态", { exact: true }).selectOption("windows");
  await dialog.getByRole("button", { name: "添加景点营业时段", exact: true }).click();
  await dialog.getByLabel("景点营业时段 1 开始", { exact: true }).fill(`${date}T10:00`);
  await dialog.getByLabel("景点营业时段 1 结束", { exact: true }).fill(`${date}T12:00`);
  return date;
}
for (const [days, travelers] of [
  [1, 1],
  [14, 20],
]) {
  test(`user opening rules on day ${days} for ${travelers} people preview, cancel, confirm and undo without route calls`, async ({
    page,
  }, testInfo) => {
    const requests = await setup(page, days, travelers);
    if (days === 14) {
      await page.getByRole("button", { name: /第 14 天/ }).click();
    }
    const name = `测试文化场馆${(days - 1) * 2 + 1}`;
    const dialog = await editor(page, name);
    const date = await opening(dialog);
    await dialog
      .getByLabel("录入景点营业与预约", { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-full-venue-form-${days}d.png`,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "预览营业与预约" }).click();
    const difference = page.getByRole("region", { name: "营业预约修改差异" });
    await expect(difference).toContainText("10:00—12:00");
    await expect(difference).toContainText("营业与预约尚未核实");
    await expect(difference).toContainText("用户记录（UTC）");
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
    await page.getByRole("button", { name: "保留原方案" }).click();
    await page.getByRole("button", { name: `查看${name}的资料`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "尚未核实，不代表已经预约或确认开放",
    );
    await page.keyboard.press("Escape");
    const again = await editor(page, name);
    await opening(again);
    await again.getByRole("button", { name: "预览营业与预约" }).click();
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-full-venue-preview-${days}d.png`,
      animations: "disabled",
    });
    await page.getByRole("button", { name: "确认此项修改" }).click();
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
    await page.getByRole("button", { name: `查看${name}的资料`, exact: true }).click();
    const saved = page.getByRole("dialog");
    await expect(saved).toContainText(`适用日期：${date}`);
    await expect(saved).toContainText("10:00—12:00");
    await expect(saved).toContainText("未知，不代表免费");
    await expect(saved).toContainText("非商家核验");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "撤销上次修改" }).click();
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
    await page.getByRole("button", { name: `查看${name}的资料`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "尚未核实，不代表已经预约或确认开放",
    );
    expect(requests()).toBe(0);
  });
}

test("venue keyboard focus stays below a variable-height sticky title after scrolling a long form", async ({
  page,
}, testInfo) => {
  if (testInfo.project.name === "desktop") {
    await page.setViewportSize({ width: 960, height: 1000 });
  }
  const name = "测试文化场馆与城市历史陈列空间".repeat(3);
  const requests = await setup(page, 14, 20, name);
  await page.getByRole("button", { name: /第 14 天/ }).click();
  const dialog = await editor(page, name);
  await opening(dialog);
  const field = dialog.getByLabel("景点规则适用日期", { exact: true });
  await field.focus();
  await expect(field).toBeFocused();
  const header = await dialog.locator(".trip-detail-header").boundingBox();
  const bounds = await field.boundingBox();
  expect(bounds!.y).toBeGreaterThanOrEqual(header!.y + header!.height + 4);
  const label = await dialog.getByText("景点规则适用日期", { exact: true }).boundingBox();
  expect(label!.y).toBeGreaterThanOrEqual(header!.y + header!.height + 4);
  await page.setViewportSize({
    width: testInfo.project.name === "desktop" ? 620 : 360,
    height: testInfo.project.name === "desktop" ? 1000 : 844,
  });
  await expect
    .poll(async () =>
      dialog.evaluate((element) =>
        Math.abs(
          parseFloat(getComputedStyle(element).scrollPaddingTop) -
            (element.querySelector(".trip-detail-header")!.getBoundingClientRect()
              .height +
              44),
        ),
      ),
    )
    .toBeLessThan(1);
  await dialog.getByLabel("景点营业时段 1 结束", { exact: true }).focus();
  await field.focus();
  const resizedHeader = await dialog.locator(".trip-detail-header").boundingBox();
  const resizedLabel = await dialog
    .getByText("景点规则适用日期", { exact: true })
    .boundingBox();
  expect(resizedLabel!.y).toBeGreaterThanOrEqual(
    resizedHeader!.y + resizedHeader!.height + 4,
  );
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-venue-focus-visible.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  expect(requests()).toBe(0);
});

for (const label of ["早餐", "午餐", "晚餐"]) {
  test(`${label} venue records on day fourteen stay independent from unknown meal prices and dietary checks`, async ({
    page,
  }, testInfo) => {
    const requests = await setup(page, 14, 20);
    await page.getByRole("button", { name: /第 14 天/ }).click();
    const name = `测试${label}店`;
    const dialog = await editor(page, name);
    await dialog.getByLabel(`录入${label}营业与预约`, { exact: true }).check();
    await dialog
      .getByLabel(`${label}预约状态`, { exact: true })
      .selectOption("not_required");
    await dialog
      .getByLabel(`录入${label}营业与预约`, { exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-full-${label}-venue-form.png`,
      animations: "disabled",
    });
    await dialog.getByRole("button", { name: "预览营业与预约" }).click();
    await expect(page.getByRole("region", { name: "营业预约修改差异" })).toContainText(
      "用户记录无需预约",
    );
    await page.getByRole("button", { name: "确认此项修改" }).click();
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
    await page.getByRole("button", { name: `查看${name}的资料`, exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("用户记录无需预约");
    await expect(page.getByRole("dialog")).toContainText("未知，不代表免费");
    await expect(page.getByRole("dialog")).toContainText("供应及饮食适配需向商家核实");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "撤销上次修改" }).click();
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
    expect(requests()).toBe(0);
  });
}

test("closed and too-short opening periods cannot confirm, and partial appointment datetimes stay in the form", async ({
  page,
}) => {
  const requests = await setup(page);
  let dialog = await editor(page);
  await dialog.getByLabel("录入景点营业与预约", { exact: true }).check();
  await dialog.getByLabel("景点营业状态", { exact: true }).selectOption("closed");
  await dialog.getByRole("button", { name: "预览营业与预约" }).click();
  await expect(page.getByRole("button", { name: "确认此项修改" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "营业预约修改差异" })).toContainText(
    "当天闭店",
  );
  await page.getByRole("button", { name: "保留原方案" }).click();
  dialog = await editor(page);
  const date = await opening(dialog);
  await dialog.getByLabel("景点营业时段 1 结束", { exact: true }).fill(`${date}T10:30`);
  await dialog.getByRole("button", { name: "预览营业与预约" }).click();
  await expect(page.getByRole("button", { name: "确认此项修改" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "新方案确认" })).toContainText(
    "请先解决行程冲突",
  );
  await page.getByRole("button", { name: "保留原方案" }).click();
  dialog = await editor(page);
  await opening(dialog);
  await dialog.getByLabel("景点预约状态", { exact: true }).selectOption("confirmed");
  await dialog
    .getByLabel("景点预约入场开始（选填）", { exact: true })
    .fill(`${date}T10:15`);
  await dialog.getByRole("button", { name: "预览营业与预约" }).click();
  await expect(dialog.getByRole("alert", { name: "营业预约填写错误" })).toContainText(
    "同时填写开始与结束",
  );
  await expect(
    dialog.getByLabel("景点预约入场开始（选填）", { exact: true }),
  ).toHaveValue(`${date}T10:15`);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  expect(requests()).toBe(0);
});

test("recorded appointments require bound explicit release, reset acknowledgement when changed, cancel safely and undo removal", async ({
  page,
}, testInfo) => {
  const requests = await setup(page);
  let dialog = await editor(page);
  const date = await opening(dialog);
  await dialog.getByLabel("景点预约状态", { exact: true }).selectOption("confirmed");
  await dialog
    .getByLabel("景点预约入场开始（选填）", { exact: true })
    .fill(`${date}T10:15`);
  await dialog
    .getByLabel("景点预约入场结束（选填）", { exact: true })
    .fill(`${date}T11:00`);
  await dialog.getByRole("button", { name: "预览营业与预约" }).click();
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  dialog = await editor(page);
  await dialog.getByLabel("景点预约状态", { exact: true }).selectOption("unknown");
  await dialog.getByRole("button", { name: "预览营业与预约" }).click();
  await expect(dialog.getByRole("alert", { name: "营业预约填写错误" })).toContainText(
    "原预约为强约束",
  );
  const acknowledgement = dialog.getByLabel(
    "我已核对景点原预约变更／移除，知晓此操作不代为取消商家预约",
    { exact: true },
  );
  await acknowledgement.check();
  await dialog
    .getByLabel("景点预约状态", { exact: true })
    .selectOption("required_unconfirmed");
  await expect(acknowledgement).not.toBeChecked();
  await acknowledgement.check();
  await dialog.getByRole("button", { name: "预览营业与预约" }).click();
  await expect(page.getByRole("region", { name: "营业预约修改差异" })).toContainText(
    "需预约，尚未取得",
  );
  await page.getByRole("button", { name: "保留原方案" }).click();
  dialog = await editor(page);
  await dialog.getByLabel("录入景点营业与预约", { exact: true }).uncheck();
  await dialog.getByRole("button", { name: "预览营业与预约" }).click();
  await expect(dialog.getByRole("alert", { name: "营业预约填写错误" })).toContainText(
    "原预约为强约束",
  );
  await dialog
    .getByLabel("我已核对景点原预约变更／移除，知晓此操作不代为取消商家预约", {
      exact: true,
    })
    .check();
  await dialog.getByRole("button", { name: "预览营业与预约" }).click();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-full-reservation-release.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "4");
  await page
    .getByRole("button", { name: "查看测试文化场馆1的资料", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("用户记录已预约，非平台核验");
  expect(requests()).toBe(0);
});
