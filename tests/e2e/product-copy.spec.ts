import { test, expect } from "@playwright/test";
import { fixtureDraft, places } from "../fixtures/draft";
import { addFixturePlaces, fixtureRecommendations } from "./fixtures";

const roadmapCopy = /本轮|后续阶段|将在后续|天气未接入|本轮已经能做/;

test("travel summary reflects inputs and the same daily grouping as the draft", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      errors.push("Hydration warning detected");
    }
  });
  await page.goto("/");
  const summary = page.getByRole("complementary", { name: "旅行摘要" });
  await expect(summary).toContainText("添加想去的地点");
  await page.getByLabel("目的地城市").fill("苏州");
  await page.getByLabel("出行日期").fill("2026-10-17");
  await page.getByLabel("同行人数").fill("3");
  await page.getByLabel("每人预算（元）").fill("1234.56");
  await expect(summary).toContainText("苏州");
  await expect(summary).toContainText("2026.10.17");
  await expect(summary).toContainText("3 人");
  await expect(summary).toContainText("1,234.56");
  await addFixturePlaces(page);
  const days = summary.locator(".summary-days > li");
  await expect(days).toHaveCount(2);
  await expect(days.nth(0)).toContainText(places[0].name);
  await expect(days.nth(0)).toContainText(places[1].name);
  await expect(days.nth(1)).toContainText(places[2].name);
  await expect(days.nth(1)).toContainText(places[3].name);
  await page.getByLabel("旅行天数").selectOption("3");
  await expect(days).toHaveCount(3);
  await expect(days.nth(1)).toContainText(places[2].name);
  await expect(days.nth(1)).not.toContainText(places[3].name);
  await page.getByRole("button", { name: `移除${places[0].name}` }).click();
  await expect(summary).not.toContainText(places[0].name);
  await page.getByLabel("每人预算（元）").fill("");
  await expect(summary).toContainText("未填写有效预算");
  await page.getByLabel("同行人数").fill("");
  await expect(summary).toContainText("请填写 1-8 人");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-travel-summary.png`,
    fullPage: true,
    caret: "initial",
  });
  expect(errors).toEqual([]);
});

test("pages show travel guidance, not a development roadmap, and AI validation stays keyboard accessible", async ({
  page,
}) => {
  await page.route("**/api/plans", (route) =>
    route.fulfill({ json: { draft: fixtureDraft() } }),
  );
  await page.route("**/api/recommendations", (route) =>
    route.fulfill({ json: fixtureRecommendations() }),
  );
  await page.goto("/");
  await expect(page.locator("body")).not.toContainText(roadmapCopy);
  await page.getByRole("button", { name: "AI 智能推荐" }).click();
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  const selected = page.getByRole("region", { name: "已选地点清单" });
  await expect(selected).toBeFocused();
  await expect(page.getByRole("alert", { name: "地点清单提示" })).toBeVisible();
  await page.getByRole("button", { name: "获取 AI 推荐", exact: true }).click();
  await page.getByRole("button", { name: `添加${places[1].name}` }).click();
  await page.getByRole("button", { name: `添加${places[2].name}` }).click();
  await expect(page.getByRole("alert", { name: "地点清单提示" })).not.toBeVisible();
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("heading", { name: "测试城市2日路线草稿" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText(roadmapCopy);
  await expect(
    page.getByText("当前行程仅保留在此页面，刷新后清空。", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("测试 fixture：此页面数据不是真实接口查询。", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("午餐与晚餐待安排", { exact: true })).toBeVisible();
});
