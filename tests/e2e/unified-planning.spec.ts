import { test, expect } from "@playwright/test";
import { places, fixtureDraft } from "../fixtures/draft";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";
import { openPlanningTools } from "./fixtures";

const aiPanel = (page: import("@playwright/test").Page) =>
  page.locator("#planning-panel-ai");
const manualPanel = (page: import("@playwright/test").Page) =>
  page.locator("#planning-panel-manual");

test("AI and manual inputs and selected places remain separate and survive keyboard mode switching", async ({
  page,
}, testInfo) => {
  let generated = 0;
  let searches = 0;
  await page.route("**/api/itineraries", (route) => {
    generated += 1;
    return route.abort();
  });
  await page.route("**/api/plans", (route) => {
    generated += 1;
    return route.abort();
  });
  await page.route("**/api/places?*", (route) => {
    searches += 1;
    return route.fulfill({ json: { places } });
  });
  await page.goto("/plan");
  const ai = aiPanel(page);
  await ai.getByLabel("目的地城市").fill("AI 旅行城市");
  await ai.getByLabel("旅行天数").fill("5");
  await openPlanningTools(page);
  await page.getByRole("tab", { name: /手动选点/ }).click();
  const manual = manualPanel(page);
  await manual.getByLabel("目的地城市").fill("手动旅行城市");
  await manual.getByLabel("每人预算（元）").fill("1234.50");
  await manual.getByLabel("搜索地点名称").fill("测试");
  await manual.getByRole("button", { name: "搜索地点", exact: true }).click();
  for (const place of places.slice(0, 2)) {
    await manual.getByRole("button", { name: `添加${place.name}`, exact: true }).click();
  }
  await expect(manual.getByRole("heading", { name: "已选 2 / 6 个地点" })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-unified-manual.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: /手动选点/ }).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("tab", { name: /完整 AI 规划/ })).toBeFocused();
  await expect(ai.getByLabel("目的地城市")).toHaveValue("AI 旅行城市");
  await expect(ai.getByLabel("旅行天数")).toHaveValue("5");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-unified-ai.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("ArrowRight");
  await expect(manual.getByLabel("目的地城市")).toHaveValue("手动旅行城市");
  await expect(manual.getByLabel("每人预算（元）")).toHaveValue("1234.50");
  await expect(manual.getByRole("heading", { name: "已选 2 / 6 个地点" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  expect(generated).toBe(0);
  expect(searches).toBe(1);
});

test("switching cannot start another planning mode during an in-flight request, cancellation ignores its late result", async ({
  page,
}) => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let calls = 0;
  await page.route("**/api/itineraries", async (route) => {
    calls += 1;
    const brief = tripBriefSchema.parse(route.request().postDataJSON());
    await gate;
    await route
      .fulfill({
        contentType: "application/x-ndjson",
        body: JSON.stringify({ type: "result", plan: fixtureItinerary(brief) }),
      })
      .catch(() => {});
    finish();
  });
  await page.goto("/plan");
  const ai = aiPanel(page);
  await ai.getByLabel("目的地城市").fill("测试城市");
  await ai.getByLabel("旅行天数").fill("1");
  await ai.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  const started = page.waitForRequest("**/api/itineraries");
  await ai.getByRole("button", { name: "生成我的完整方案" }).click();
  await started;
  await openPlanningTools(page);
  await page.getByRole("tab", { name: /手动选点/ }).click();
  await expect(page.getByRole("tab", { name: /完整 AI 规划/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.locator(".unified-mode-message")).toContainText("等待当前生成完成");
  await ai.getByRole("button", { name: "取消生成" }).click();
  await page.getByRole("tab", { name: /手动选点/ }).click();
  await expect(manualPanel(page)).toBeVisible();
  release();
  await done;
  await expect(page.locator(".unified-planner")).toHaveAttribute(
    "data-plan-revision",
    "0",
  );
  expect(calls).toBe(1);
});

test("manual route drafts and full AI proposals both remain in the same workspace without replacing each other", async ({
  page,
}) => {
  let manualCalls = 0;
  let aiCalls = 0;
  await page.route("**/api/places?*", (route) => route.fulfill({ json: { places } }));
  await page.route("**/api/plans", (route) => {
    manualCalls += 1;
    return route.fulfill({ json: { draft: fixtureDraft() } });
  });
  await page.route("**/api/itineraries", (route) => {
    aiCalls += 1;
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        type: "result",
        plan: fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON())),
      }),
    });
  });
  await page.goto("/plan?mode=manual");
  const manual = manualPanel(page);
  await manual.getByLabel("目的地城市").fill("测试城市");
  await manual.getByLabel("搜索地点名称").fill("测试");
  await manual.getByRole("button", { name: "搜索地点", exact: true }).click();
  for (const place of places) {
    await manual.getByRole("button", { name: `添加${place.name}`, exact: true }).click();
  }
  await manual.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(
    manual.getByRole("heading", { name: "测试城市2日路线草稿" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /完整 AI 规划/ }).click();
  const ai = aiPanel(page);
  await ai.getByLabel("目的地城市").fill("AI 测试城市");
  await ai.getByLabel("旅行天数").fill("1");
  await ai.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await ai.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(ai.getByRole("heading", { name: "在城市的文化与烟火之间" })).toBeVisible();
  await expect(page).toHaveURL(/\/plan\?mode=manual$/);
  await openPlanningTools(page);
  await page.getByRole("tab", { name: /手动选点/ }).click();
  await expect(
    manual.getByRole("heading", { name: "测试城市2日路线草稿" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: /完整 AI 规划/ }).click();
  await ai.getByRole("button", { name: "返回当前方案", exact: true }).click();
  await expect(ai.getByRole("heading", { name: "在城市的文化与烟火之间" })).toBeVisible();
  expect(manualCalls).toBe(1);
  expect(aiCalls).toBe(1);
});
