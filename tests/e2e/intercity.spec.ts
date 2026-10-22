import { test, expect, type Page } from "@playwright/test";
import { fixtureDraft, places, route } from "../fixtures/draft";
import { addFixturePlaces } from "./fixtures";

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
const dialog = (page: Page) =>
  page.getByRole("dialog", { name: "跨城安排", exact: true });
const saved = (page: Page) => page.locator(".saved-intercity");
async function openDraft(page: Page) {
  await page.route("**/api/plans", (request) =>
    request.fulfill({ json: { draft: fixtureDraft() } }),
  );
  await page.goto("/manual");
  await addFixturePlaces(page);
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("region", { name: "跨城安排", exact: true })).toBeVisible();
}
async function openForm(page: Page) {
  await page.getByRole("button", { name: "填写跨城安排", exact: true }).click();
  await expect(dialog(page)).toBeVisible();
}
async function fillArrival(page: Page) {
  await page.getByLabel("录入到达班次", { exact: true }).check();
  await page.getByLabel("到达班次号（选填，不填订单号）").fill("TEST001");
  await page.getByLabel("到达出发站／机场", { exact: true }).fill("测试出发站");
  await page.getByLabel("到达到达站／机场", { exact: true }).fill("测试到达站");
  await page.getByLabel("到达出发日期时间", { exact: true }).fill("2026-10-16T23:40");
  await page.getByLabel("到达到达日期时间", { exact: true }).fill("2026-10-17T07:30");
  await page.getByLabel("到达进出站缓冲（分钟）", { exact: true }).fill("20");
  await page.getByLabel("到达接驳总耗时（分钟）", { exact: true }).fill("50");
  await page.getByLabel("到达每人票价估算（元）", { exact: true }).fill("1.10");
}
async function fillBoth(page: Page) {
  await fillArrival(page);
  await page.getByLabel("录入返程班次", { exact: true }).check();
  await page.getByLabel("返程交通方式", { exact: true }).selectOption("flight");
  await page.getByLabel("返程出发站／机场", { exact: true }).fill("测试出发机场");
  await page.getByLabel("返程到达站／机场", { exact: true }).fill("测试到达机场");
  await page.getByLabel("返程出发日期时间", { exact: true }).fill("2026-10-18T14:00");
  await page.getByLabel("返程到达日期时间", { exact: true }).fill("2026-10-18T21:30");
  await page.getByLabel("返程进出站缓冲（分钟）", { exact: true }).fill("30");
  await page.getByLabel("返程接驳总耗时（分钟）", { exact: true }).fill("45");
}
async function preview(page: Page) {
  await dialog(page).getByRole("button", { name: "预览跨城安排", exact: true }).click();
}
async function confirm(page: Page) {
  await dialog(page).getByRole("button", { name: "确认跨城安排", exact: true }).click();
}
async function saveBoth(page: Page) {
  await openForm(page);
  await fillBoth(page);
  await preview(page);
  await confirm(page);
}

test("dated manual records preview before applying, preserve budget/locks, and undo with no supplier calls", async ({
  page,
}, testInfo) => {
  let requests = 0;
  page.on("request", (request) => {
    if (/\/api\/(routes|weather|recommendations)/.test(request.url())) {
      requests += 1;
    }
  });
  await openDraft(page);
  await page.getByRole("button", { name: "锁定位置", exact: true }).first().click();
  const before = await page.locator(".timeline").innerText();
  await openForm(page);
  await fillBoth(page);
  await preview(page);
  await expect(saved(page)).toContainText("尚未录入跨城班次");
  await expect(dialog(page)).toContainText("2026/10/16 23:40");
  await expect(dialog(page)).toContainText("2026/10/17 07:30");
  await expect(dialog(page)).toContainText("票价手动估算 ¥1.10 / 人");
  await expect(dialog(page)).toContainText("余量 20 分钟");
  await expect(dialog(page)).toContainText("余量 10 分钟");
  await expect(
    dialog(page).getByRole("heading", { name: "跨城安排", exact: true }),
  ).toBeFocused();
  await expect(
    dialog(page).getByRole("heading", { name: "跨城安排", exact: true }),
  ).toBeInViewport();
  await expect.poll(() => dialog(page).evaluate((element) => element.scrollTop)).toBe(0);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-intercity-preview.png`,
    fullPage: false,
    caret: "initial",
  });
  await confirm(page);
  await expect(
    page.getByRole("button", { name: "填写跨城安排", exact: true }),
  ).toBeFocused();
  await expect(saved(page)).toContainText("到达 · 铁路 TEST001");
  await expect(saved(page)).toContainText("返程 · 航班");
  await expect(saved(page)).toContainText("手动估算 50 分钟");
  await expect(page.locator(".saved-budget")).toContainText("暂无费用估算");
  expect(await page.locator(".timeline").innerText()).toBe(before);
  await expect(page.getByRole("button", { name: "位置已锁", exact: true })).toHaveCount(
    1,
  );
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(saved(page)).toContainText("尚未录入跨城班次");
  await expect(page.getByRole("button", { name: "位置已锁", exact: true })).toHaveCount(
    1,
  );
  expect(requests).toBe(0);
});

test("fare prefill requires both prices, replaces rather than adds, previews before committing and undoes without changing trips", async ({
  page,
}, testInfo) => {
  await openDraft(page);
  await page.getByRole("button", { name: "锁定位置", exact: true }).first().click();
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  const budget = page.getByRole("dialog", { name: "费用估算", exact: true });
  await budget.getByLabel("跨城往返估算（元）").fill("10");
  await budget.getByLabel("跨城往返口径").selectOption("trip");
  await budget.getByLabel("市内交通估算（元）").fill("1.10");
  await budget.getByLabel("市内交通口径").selectOption("trip");
  await budget.getByRole("button", { name: "预览费用", exact: true }).click();
  await budget.getByRole("button", { name: "确认费用", exact: true }).click();
  await saveBoth(page);
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  await expect(budget.getByRole("button", { name: "使用已录入两程票价" })).toBeDisabled();
  await expect(budget).toContainText("不能把已知部分当作完整往返费用");
  await page.keyboard.press("Escape");
  await openForm(page);
  await page.getByLabel("返程每人票价估算（元）", { exact: true }).fill("2.20");
  await preview(page);
  await confirm(page);
  const itinerary = await page.locator(".timeline").innerText();
  const intercity = await saved(page).innerText();
  const costs = page.locator(".saved-budget");
  await expect(costs).toContainText("已录入估算 ¥11.10");
  for (const apply of [false, true]) {
    await page.getByRole("button", { name: "填写费用", exact: true }).click();
    await budget.getByRole("button", { name: "使用已录入两程票价" }).click();
    await expect(budget.getByLabel("跨城往返估算（元）")).toHaveValue("3.30");
    await expect(budget.getByLabel("跨城往返估算（元）")).toBeFocused();
    await expect(budget.getByLabel("跨城往返口径")).toHaveValue("per_person");
    await expect(budget.getByLabel("市内交通估算（元）")).toHaveValue("1.10");
    await expect(budget.getByLabel("市内交通口径")).toHaveValue("trip");
    expect(
      await budget.evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    if (!apply) {
      const layout = await budget.getByLabel("两程票价预填").evaluate((element) => {
        const button = element.querySelector("button")!.getBoundingClientRect();
        const paragraphs = [...element.querySelectorAll("p")].map((paragraph) =>
          paragraph.getBoundingClientRect(),
        );
        return {
          firstTop: paragraphs[0].top,
          buttonBottom: button.bottom,
          secondTop: paragraphs[1].top,
          firstBottom: paragraphs[0].bottom,
        };
      });
      expect(layout.firstTop).toBeGreaterThanOrEqual(layout.buttonBottom);
      expect(layout.secondTop).toBeGreaterThanOrEqual(layout.firstBottom);
      await page.screenshot({
        path: `test-results/${testInfo.project.name}-intercity-fare-prefill.png`,
        fullPage: false,
        caret: "initial",
      });
    }
    await budget.getByRole("button", { name: "预览费用", exact: true }).click();
    await expect(budget.getByLabel("费用修改预览")).toContainText("已录入估算 ¥7.70");
    await expect(costs).toContainText("已录入估算 ¥11.10");
    if (apply) {
      await budget.getByRole("button", { name: "确认费用", exact: true }).click();
    } else {
      await page.keyboard.press("Escape");
      await expect(costs).toContainText("已录入估算 ¥11.10");
    }
  }
  await expect(costs).toContainText("已录入估算 ¥7.70");
  expect(await saved(page).innerText()).toBe(intercity);
  expect(await page.locator(".timeline").innerText()).toBe(itinerary);
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(costs).toContainText("已录入估算 ¥11.10");
  expect(await saved(page).innerText()).toBe(intercity);
});

test("zero fares can prefill without claiming free travel or changing the excluded budget scope", async ({
  page,
}) => {
  await openDraft(page);
  await openForm(page);
  await fillBoth(page);
  await page.getByLabel("到达每人票价估算（元）", { exact: true }).fill("0");
  await page.getByLabel("返程每人票价估算（元）", { exact: true }).fill("0");
  await preview(page);
  await confirm(page);
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  const budget = page.getByRole("dialog", { name: "费用估算", exact: true });
  await budget.getByLabel("计入跨城往返", { exact: true }).uncheck();
  await budget.getByRole("button", { name: "使用已录入两程票价" }).click();
  await expect(budget.getByLabel("跨城往返估算（元）")).toHaveValue("0.00");
  await expect(budget.getByLabel("计入跨城往返", { exact: true })).not.toBeChecked();
  await budget.getByRole("button", { name: "预览费用", exact: true }).click();
  await expect(budget).toContainText("当前预算范围不包含跨城往返");
  await budget.getByRole("button", { name: "确认费用", exact: true }).click();
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  await expect(budget.getByLabel("跨城往返估算（元）")).toHaveValue("0.00");
  await expect(budget.getByLabel("计入跨城往返", { exact: true })).not.toBeChecked();
  await page.keyboard.press("Escape");
  const before = await page.locator(".saved-budget").innerText();
  await openForm(page);
  await page.getByLabel("返程每人票价估算（元）", { exact: true }).fill("12.30");
  await preview(page);
  await confirm(page);
  expect(await page.locator(".saved-budget").innerText()).toBe(before);
});

test("combined fares beyond the budget item limit cannot prefill a truncated estimate", async ({
  page,
}) => {
  await openDraft(page);
  await openForm(page);
  await fillBoth(page);
  await page.getByLabel("到达每人票价估算（元）", { exact: true }).fill("60000");
  await page.getByLabel("返程每人票价估算（元）", { exact: true }).fill("60000");
  await preview(page);
  await confirm(page);
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  const budget = page.getByRole("dialog", { name: "费用估算", exact: true });
  await expect(budget.getByRole("button", { name: "使用已录入两程票价" })).toBeDisabled();
  await expect(budget).toContainText("两程每人合计超出单项十万元上限");
  await expect(budget.getByLabel("跨城往返估算（元）")).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.locator(".saved-budget")).toContainText("暂无费用估算");
});

test("return-to-form and Escape preserve inputs until closing, without applying the preview", async ({
  page,
}) => {
  await openDraft(page);
  await openForm(page);
  await fillArrival(page);
  await preview(page);
  await dialog(page).getByRole("button", { name: "返回填写", exact: true }).click();
  await expect(page.getByLabel("到达出发日期时间", { exact: true })).toHaveValue(
    "2026-10-16T23:40",
  );
  await preview(page);
  await page.keyboard.press("Escape");
  await expect(dialog(page)).not.toBeVisible();
  await expect(
    page.getByRole("button", { name: "填写跨城安排", exact: true }),
  ).toBeFocused();
  await expect(saved(page)).toContainText("尚未录入跨城班次");
  await openForm(page);
  await expect(page.getByLabel("录入到达班次", { exact: true })).not.toBeChecked();
});

test("a known conflict with unknown transfer requires acknowledgement and never changes a locked activity", async ({
  page,
}) => {
  await openDraft(page);
  await page.getByRole("button", { name: "锁定时间", exact: true }).first().click();
  await openForm(page);
  await fillArrival(page);
  await page.getByLabel("到达到达日期时间", { exact: true }).fill("2026-10-17T10:00");
  await page.getByLabel("到达进出站缓冲（分钟）", { exact: true }).fill("");
  await page.getByLabel("到达接驳总耗时（分钟）", { exact: true }).fill("");
  await preview(page);
  await expect(dialog(page)).toContainText("已知时间或缓冲已冲突");
  await expect(
    dialog(page).getByRole("button", { name: "确认跨城安排", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("我知道时间冲突，仅记录含冲突的草稿", { exact: true }).check();
  await confirm(page);
  await expect(page.getByText("存在时间冲突", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "时间已锁", exact: true })).toHaveCount(
    1,
  );
  await expect(page.locator(".timeline .stop-time").first()).toHaveText("09:00");
  await expect(saved(page)).toContainText("接驳：未知");
});

test("later stay changes are checked against the recorded return constraint", async ({
  page,
}) => {
  await openDraft(page);
  await saveBoth(page);
  await page.getByRole("button", { name: "第 2 天", exact: true }).click();
  await page
    .getByRole("group", { name: `调整${places[3].name}`, exact: true })
    .getByRole("button", { name: "调整", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "调整行程", exact: true });
  await page.getByLabel("停留时间（分钟）").fill("120");
  await editor.getByRole("button", { name: "预览修改", exact: true }).click();
  await expect(
    editor.getByRole("region", { name: "修改后跨城校验", exact: true }),
  ).toContainText("无法赶上返程");
  await expect(editor).toContainText("到达／返程约束冲突");
  await expect(
    editor.getByRole("button", { name: "确认修改", exact: true }),
  ).toBeDisabled();
  await expect(page.locator(".timeline .stop-card").last()).toContainText("停留 90 分钟");
});

test("bad amounts remain invalid, explicit zero stays manual, removal can be undone", async ({
  page,
}) => {
  await openDraft(page);
  await openForm(page);
  await fillArrival(page);
  await page.getByLabel("到达每人票价估算（元）", { exact: true }).fill("1.234");
  await preview(page);
  await expect(dialog(page).getByRole("alert", { name: "跨城录入失败" })).toContainText(
    "最多两位小数",
  );
  await expect(page.getByLabel("到达出发站／机场", { exact: true })).toHaveValue(
    "测试出发站",
  );
  await page.getByLabel("到达每人票价估算（元）", { exact: true }).fill("0");
  await preview(page);
  await confirm(page);
  await expect(saved(page)).toContainText("票价手动估算 ¥0.00 / 人");
  await openForm(page);
  await page.getByLabel("录入到达班次", { exact: true }).uncheck();
  await preview(page);
  await confirm(page);
  await expect(saved(page)).toContainText("尚未录入跨城班次");
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(saved(page)).toContainText("票价手动估算 ¥0.00 / 人");
});

test("reordered endpoints invalidate the old manual transfer and never relabel it as a new estimate", async ({
  page,
}) => {
  await page.route("**/api/routes", (request) => request.fulfill({ json: { route } }));
  await openDraft(page);
  await saveBoth(page);
  await page
    .getByRole("group", { name: `调整${places[0].name}`, exact: true })
    .getByRole("button", { name: "调整", exact: true })
    .click();
  const editor = page.getByRole("dialog", { name: "调整行程", exact: true });
  await page.getByLabel("当天顺序").selectOption("1");
  await editor.getByRole("button", { name: "预览修改", exact: true }).click();
  await expect(editor).toContainText("接驳方向或端点已变化");
  await editor.getByRole("button", { name: "查询受影响路线", exact: true }).click();
  await editor.getByRole("button", { name: "确认修改", exact: true }).click();
  await expect(saved(page)).toContainText("接驳方向或端点已变化");
  await expect(saved(page)).not.toContainText("手动估算 50 分钟");
  await openForm(page);
  await expect(page.getByLabel("到达接驳总耗时（分钟）", { exact: true })).toHaveValue(
    "",
  );
  await expect(page.getByLabel("返程接驳总耗时（分钟）", { exact: true })).toHaveValue(
    "45",
  );
});
