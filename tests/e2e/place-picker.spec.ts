import { test, expect, type Page } from "@playwright/test";
import { places, fixtureDraft } from "../fixtures/draft";
import { searchFixture, fixtureRecommendations } from "./fixtures";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      messages.push("Hydration warning detected");
    }
  });
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));

test("explicit search choices send POI IDs in the user's order", async ({ page }) => {
  await page.route("**/api/plans", (route) => {
    expect(
      route
        .request()
        .postDataJSON()
        .selections.map((item: { poiId: string }) => item.poiId),
    ).toEqual([places[2].id, places[0].id]);
    return route.fulfill({ json: { draft: fixtureDraft() } });
  });
  await page.goto("/");
  await searchFixture(page);
  await page.getByRole("button", { name: `添加${places[2].name}` }).click();
  await page.getByRole("button", { name: `添加${places[0].name}` }).click();
  await expect(page.getByRole("heading", { name: "已选 2 / 6 个地点" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `添加${places[0].name}` }),
  ).toBeDisabled();
  await page.getByRole("button", { name: `移除${places[0].name}` }).click();
  await expect(page.getByRole("heading", { name: "已选 1 / 6 个地点" })).toBeVisible();
  await page.getByRole("button", { name: `添加${places[0].name}` }).click();
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("heading", { name: "测试城市2日路线草稿" })).toBeVisible();
});

test("AI suggestions coexist with search choices and require explicit addition", async ({
  page,
}, testInfo) => {
  await page.route("**/api/recommendations", (route) => {
    const input = route.request().postDataJSON();
    expect(input.interests).toEqual(["自然风光", "博物馆"]);
    expect(input.selections).toBeUndefined();
    return route.fulfill({ json: fixtureRecommendations() });
  });
  await page.goto("/");
  await searchFixture(page);
  await page.getByRole("button", { name: `添加${places[0].name}` }).click();
  await page.getByRole("button", { name: "AI 智能推荐" }).click();
  await page.getByRole("button", { name: "获取 AI 推荐" }).click();
  await expect(page.getByText(/模型：fixture-model/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "已选 1 / 6 个地点" })).toBeVisible();
  await page.getByRole("button", { name: `添加${places[1].name}` }).click();
  await expect(page.getByRole("heading", { name: "已选 2 / 6 个地点" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-ai-picker.png`,
    fullPage: true,
    caret: "initial",
  });
  await page.getByRole("button", { name: "自定义地点", exact: true }).click();
  await expect(
    page.getByRole("button", { name: `添加${places[1].name}` }),
  ).toBeDisabled();
});

test("AI failure keeps custom choices and never inserts fallback suggestions", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/recommendations", (route) => {
    calls++;
    return route.fulfill(
      calls === 1
        ? { status: 503, json: { message: "模型未配置。" } }
        : { json: fixtureRecommendations() },
    );
  });
  await page.goto("/");
  await searchFixture(page);
  await page.getByRole("button", { name: `添加${places[0].name}` }).click();
  await page.getByRole("button", { name: "AI 智能推荐" }).click();
  await page.getByRole("button", { name: "获取 AI 推荐" }).click();
  await expect(page.getByRole("alert", { name: "AI推荐失败" })).toContainText(
    "模型未配置",
  );
  await expect(page.getByRole("heading", { name: "已选 1 / 6 个地点" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `添加${places[1].name}` }),
  ).not.toBeVisible();
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "获取 AI 推荐" }).click();
  await expect(page.getByText(/模型：fixture-model/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "已选 1 / 6 个地点" })).toBeVisible();
  expect(calls).toBe(2);
});

test("map selection dialog blocks fabricated coordinates when configuration is missing", async ({
  page,
}, testInfo) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "地图选点", exact: true }),
  ).toBeDisabled();
  await searchFixture(page);
  await page.getByRole("button", { name: "地图选点", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "地图添加地点" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "地图暂不可用，无法选点" }),
  ).toBeVisible();
  await page.getByLabel("自定义地点名称").fill("测试用户点");
  await expect(
    page.getByRole("button", { name: "添加到清单", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-point-picker.png`,
    fullPage: true,
    caret: "initial",
  });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "地图选点", exact: true })).toBeFocused();
});

test("changing city requires confirmation and invalidates old search candidates", async ({
  page,
}) => {
  await page.goto("/");
  await searchFixture(page);
  await page.getByRole("button", { name: `添加${places[0].name}` }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await page.getByLabel("目的地城市").fill("苏州");
  await expect(page.getByLabel("目的地城市")).toHaveValue("杭州");
  await expect(page.getByRole("heading", { name: "已选 1 / 6 个地点" })).toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByLabel("目的地城市").fill("苏州");
  await expect(page.getByRole("heading", { name: "已选 0 / 6 个地点" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: `添加${places[0].name}` }),
  ).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "地图选点", exact: true }),
  ).toBeDisabled();
});
