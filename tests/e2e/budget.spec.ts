import { test, expect, type Page } from "@playwright/test";
import { fixtureDraft } from "../fixtures/draft";
import { addFixturePlaces } from "./fixtures";

const messages = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  messages.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      errors.push("Hydration warning detected");
    }
  });
});
test.afterEach(({ page }) => expect(messages.get(page)).toEqual([]));

async function openBudget(page: Page) {
  await page.route("**/api/plans", (request) =>
    request.fulfill({ json: { draft: fixtureDraft() } }),
  );
  await page.goto("/");
  await addFixturePlaces(page);
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("region", { name: "旅行预算" })).toBeVisible();
  await page.getByRole("button", { name: "填写费用" }).click();
}
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "费用估算", exact: true });
const saved = (page: Page) => page.locator(".saved-budget");

async function fillAll(page: Page) {
  await page.getByLabel("跨城往返估算（元）").fill("400");
  await page.getByLabel("市内交通估算（元）").fill("50");
  await page.getByLabel("住宿估算（元）").fill("600");
  await expect(page.getByLabel("住宿口径")).toHaveValue("trip");
  await page.getByLabel("餐饮估算（元）").fill("250");
  await page.getByLabel("门票估算（元）").fill("100");
}

test("all-category estimates use party or per-person totals, preview before applying, and undo", async ({
  page,
}, testInfo) => {
  await openBudget(page);
  await expect(saved(page)).toContainText("暂无费用估算");
  await expect(saved(page).locator(".budget-facts dd")).toHaveText(
    Array(5).fill("费用未知"),
  );
  await fillAll(page);
  await dialog(page).getByRole("button", { name: "预览费用" }).click();
  await expect(
    dialog(page).getByRole("heading", { name: "费用估算", exact: true }),
  ).toBeInViewport();
  await expect(
    dialog(page).getByRole("heading", { name: "费用估算", exact: true }),
  ).toBeFocused();
  await expect.poll(() => dialog(page).evaluate((element) => element.scrollTop)).toBe(0);
  await expect(saved(page)).toContainText("暂无费用估算");
  await expect(dialog(page)).toContainText("已录入估算 ¥2,200.00");
  await expect(dialog(page)).toContainText("人均已录入约 ¥1,100.00");
  await expect(dialog(page)).toContainText("非实时价格");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await dialog(page).getByRole("button", { name: "返回填写" }).click();
  await expect(
    dialog(page).getByRole("heading", { name: "费用估算", exact: true }),
  ).toBeInViewport();
  await expect(
    dialog(page).getByRole("heading", { name: "费用估算", exact: true }),
  ).toBeFocused();
  await expect(page.getByLabel("住宿估算（元）")).toHaveValue("600");
  await dialog(page).getByRole("button", { name: "预览费用" }).click();
  await expect.poll(() => dialog(page).evaluate((element) => element.scrollTop)).toBe(0);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-budget-preview.png`,
    fullPage: false,
    caret: "initial",
  });
  await dialog(page).getByRole("button", { name: "确认费用" }).click();
  await expect(saved(page)).toContainText("已录入估算 ¥2,200.00");
  await expect(page.getByRole("button", { name: "填写费用" })).toBeFocused();
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(saved(page)).toContainText("暂无费用估算");
});

test("over-budget estimates require acknowledgement, unknown fees remain unknown, and excluding intercity is explicit", async ({
  page,
}) => {
  await openBudget(page);
  await page.getByLabel("跨城往返估算（元）").fill("2000");
  await dialog(page).getByRole("button", { name: "预览费用" }).click();
  await expect(dialog(page)).toContainText("超出总预算目标 ¥1,000.00");
  await expect(dialog(page).getByRole("button", { name: "确认费用" })).toBeDisabled();
  await page.getByLabel("我知道费用估算已超预算目标").check();
  await dialog(page).getByRole("button", { name: "确认费用" }).click();
  await expect(saved(page)).toContainText("超出总预算目标 ¥1,000.00");
  await expect(page.getByText("预算估算超目标", { exact: true })).toBeVisible();
  await expect(saved(page).locator(".budget-facts dd").nth(1)).toHaveText("费用未知");
  await page.getByRole("button", { name: "填写费用" }).click();
  await page.getByLabel("计入跨城往返").uncheck();
  await dialog(page).getByRole("button", { name: "预览费用" }).click();
  await dialog(page).getByRole("button", { name: "确认费用" }).click();
  await expect(saved(page)).toContainText("当前预算范围不包含跨城往返");
  await expect(saved(page)).toContainText("还有未知费用");
  await expect(saved(page).locator(".budget-facts dd").first()).toHaveText("未计入");
  await page.getByRole("button", { name: "填写费用" }).click();
  await expect(page.getByLabel("跨城往返估算（元）")).toHaveValue("2000.00");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "填写费用" })).toBeFocused();
});

test("invalid amounts are not converted to zero; explicit zero and precise decimals remain manual estimates", async ({
  page,
}) => {
  await openBudget(page);
  await page.getByLabel("市内交通估算（元）").fill("1.001");
  await dialog(page).getByRole("button", { name: "预览费用" }).click();
  await expect(dialog(page).getByRole("alert", { name: "费用填写失败" })).toContainText(
    "金额无效",
  );
  await expect(saved(page)).toContainText("暂无费用估算");
  await page.getByLabel("市内交通估算（元）").fill("1.10");
  await page.getByLabel("门票估算（元）").fill("0");
  await dialog(page).getByRole("button", { name: "预览费用" }).click();
  await dialog(page).getByRole("button", { name: "确认费用" }).click();
  await expect(saved(page)).toContainText("已录入估算 ¥2.20");
  await expect(saved(page).locator(".budget-facts dd").last()).toHaveText("¥0.00");
  await expect(saved(page)).toContainText("还有未知费用");
  await expect(saved(page)).not.toContainText("免费");
});
