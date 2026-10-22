import { test, expect, type Page } from "@playwright/test";
import { fixtureDraft, places, route as walking } from "../fixtures/draft";
import { addFixturePlaces } from "./fixtures";
const food = [
  {
    ...places[0],
    id: "meal-lunch",
    name: "测试午餐店",
    address: "测试餐厅地址一",
    location: [120.15, 30.25],
  },
  {
    ...places[1],
    id: "meal-dinner",
    name: "测试晚餐店",
    address: "测试餐厅地址二",
    location: [120.16, 30.26],
  },
];
const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const messages: string[] = [];
  errors.set(page, messages);
  page.on("pageerror", (error) => messages.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat|same key/i.test(message.text())) {
      messages.push(message.text());
    }
  });
});
test.afterEach(({ page }) => expect(errors.get(page)).toEqual([]));
const editor = (page: Page) =>
  page.getByRole("dialog", { name: "午晚餐安排", exact: true });
const order = (page: Page) => page.locator(".timeline .stop-card strong");
async function openDraft(page: Page, sameVenue = false) {
  await page.route("**/api/plans", (request) =>
    request.fulfill({ json: { draft: fixtureDraft() } }),
  );
  await page.goto("/manual");
  await addFixturePlaces(page);
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await page.route("**/api/places?*", (request) =>
    request.fulfill({ json: { places: sameVenue ? [food[0]] : food } }),
  );
  await page.getByRole("button", { name: "安排午晚餐", exact: true }).click();
  await expect(editor(page)).toBeVisible();
}
async function choose(page: Page, sameVenue = false) {
  for (const [index, label] of ["午餐", "晚餐"].entries()) {
    await editor(page).getByLabel(`${label}餐厅关键词`).fill("测试餐厅");
    await editor(page)
      .getByRole("button", { name: `搜索${label}餐厅`, exact: true })
      .click();
    await editor(page)
      .getByRole("button", {
        name: `${label}选择${food[sameVenue ? 0 : index].name}`,
        exact: true,
      })
      .click();
  }
  await editor(page).getByLabel("午餐每人餐费估算（元，选填）").fill("1.10");
  await editor(page).getByLabel("晚餐每人餐费估算（元，选填）").fill("0");
}

async function confirmMealDay(page: Page, lunch = "1.10", dinner = "0") {
  await choose(page);
  await editor(page).getByLabel("午餐每人餐费估算（元，选填）").fill(lunch);
  await editor(page).getByLabel("晚餐每人餐费估算（元，选填）").fill(dinner);
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
}
async function secondMealDay(page: Page, lunch = "1.10", dinner = "0") {
  await page.getByRole("button", { name: "第 2 天", exact: true }).click();
  await page.getByRole("button", { name: "安排午晚餐", exact: true }).click();
  await confirmMealDay(page, lunch, dinner);
}
async function recordLunchVenue(page: Page) {
  await editor(page)
    .getByRole("button", { name: "填写午餐营业与预约", exact: true })
    .click();
  await editor(page).getByLabel("录入午餐营业与预约", { exact: true }).check();
  await editor(page).getByLabel("午餐营业状态", { exact: true }).selectOption("windows");
  await editor(page)
    .getByRole("button", { name: "添加午餐营业时段", exact: true })
    .click();
  await editor(page)
    .getByLabel("午餐营业时段 1 开始", { exact: true })
    .fill("2026-10-17T10:00");
  await editor(page)
    .getByLabel("午餐营业时段 1 结束", { exact: true })
    .fill("2026-10-17T14:00");
  await editor(page)
    .getByLabel("午餐最晚入场（选填）", { exact: true })
    .fill("2026-10-17T12:00");
  await editor(page)
    .getByLabel("午餐预约状态", { exact: true })
    .selectOption("confirmed");
  await editor(page)
    .getByLabel("午餐预约入场开始（选填）", { exact: true })
    .fill("2026-10-17T11:30");
  await editor(page)
    .getByLabel("午餐预约入场结束（选填）", { exact: true })
    .fill("2026-10-17T12:00");
}
const budgetDialog = (page: Page) =>
  page.getByRole("dialog", { name: "费用估算", exact: true });

test("explicit meal search, directed local queries, full timeline, immutable budget and undo", async ({
  page,
}, testInfo) => {
  const calls: unknown[] = [];
  await page.route("**/api/routes", (request) => {
    calls.push(request.request().postDataJSON());
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page);
  expect(
    await editor(page).evaluate((node) => {
      const box = node.getBoundingClientRect();
      return [...node.querySelectorAll<HTMLInputElement>("input")].every((input) => {
        const bounds = input.getBoundingClientRect();
        return bounds.left >= box.left && bounds.right <= box.right;
      });
    }),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-meal-form.png`,
    caret: "initial",
  });
  await choose(page);
  const budget = await page.locator(".budget-panel").textContent();
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  expect(calls).toEqual([]);
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  await expect(editor(page)).toContainText("需查询 3 段");
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "确认用餐安排", exact: true }),
  ).toBeEnabled();
  expect(calls).toEqual([
    { origin: places[0].location, destination: food[0].location },
    { origin: food[0].location, destination: places[1].location },
    { origin: places[1].location, destination: food[1].location },
  ]);
  await expect(editor(page).locator("#meal-dialog-title")).toBeFocused();
  expect(await editor(page).evaluate((node) => node.scrollTop)).toBe(0);
  expect(
    await editor(page).evaluate((node) => node.scrollWidth <= node.clientWidth + 1),
  ).toBe(true);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-meal-preview.png`,
    caret: "initial",
  });
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await expect(editor(page)).not.toBeVisible();
  await expect(order(page)).toHaveText([
    places[0].name,
    `午餐 · ${food[0].name}`,
    places[1].name,
    `晚餐 · ${food[1].name}`,
  ]);
  await expect(page.locator(".timeline .stop-time")).toHaveText([
    "09:00",
    "11:30",
    "13:05",
    "17:30",
  ]);
  expect(await page.locator(".budget-panel").textContent()).toBe(budget);
  await expect(
    page.getByRole("button", { name: "调整午晚餐", exact: true }),
  ).toBeFocused();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-meal-workspace.png`,
    fullPage: true,
    caret: "initial",
  });
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  expect(calls).toHaveLength(3);
});

test("back-to-form retains selection, partial failures only retry unfinished meal edges and no proposal silently applies", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    return request.fulfill(
      calls === 2
        ? { status: 503, json: { message: "测试用餐路线失败。" } }
        : { json: { route: walking } },
    );
  });
  await openDraft(page);
  await choose(page);
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "返回填写", exact: true }).click();
  await expect(editor(page)).toContainText(`已选：${food[0].name}`);
  await expect(editor(page).getByLabel("午餐每人餐费估算（元，选填）")).toHaveValue(
    "1.10",
  );
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await expect(editor(page).getByRole("alert", { name: "用餐修改失败" })).toContainText(
    "测试用餐路线失败",
  );
  expect(calls).toBe(2);
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "确认用餐安排", exact: true }),
  ).toBeEnabled();
  expect(calls).toBe(4);
  await editor(page).press("Escape");
  await expect(editor(page)).not.toBeVisible();
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  await expect(
    page.getByRole("button", { name: "安排午晚餐", exact: true }),
  ).toBeFocused();
});

test("same restaurant lunch and dinner have independent selection/details and stay edits preserve locked full times", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page, true);
  await choose(page, true);
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  for (const label of ["午餐", "晚餐"]) {
    await page
      .locator(".timeline .stop-card")
      .filter({ hasText: `${label} · ${food[0].name}` })
      .click();
    await expect(page.locator(".timeline .stop-card[aria-pressed=true]")).toHaveCount(1);
    const details =
      testInfo.project.name === "mobile"
        ? page.getByRole("dialog", { name: "地点详情", exact: true })
        : page.getByRole("complementary", { name: "地点详情", exact: true });
    await expect(details).toContainText(label === "午餐" ? "¥1.10 / 人" : "¥0.00 / 人");
    await expect(details).toContainText("尚未核对");
    if (testInfo.project.name === "mobile") {
      await details.getByRole("button", { name: "关闭地点详情" }).click();
    }
  }
  const controls = page.getByRole("group", {
    name: `调整${places[1].name}`,
    exact: true,
  });
  await controls.getByRole("button", { name: "锁定时间", exact: true }).click();
  await page
    .getByRole("group", { name: `调整${places[0].name}`, exact: true })
    .getByRole("button", { name: "调整", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "调整行程", exact: true });
  await edit.getByLabel("停留时间（分钟）").fill("150");
  await edit.getByRole("button", { name: "预览修改", exact: true }).click();
  await expect(edit).toContainText("锁定");
  await expect(
    edit.getByRole("button", { name: "确认修改", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(3);
});

test("position conflicts, invalid estimates and dietary conflicts do not permit route queries or overwrites", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page);
  await editor(page).press("Escape");
  await page
    .getByRole("group", { name: `调整${places[1].name}`, exact: true })
    .getByRole("button", { name: "锁定位置", exact: true })
    .click();
  await page.getByRole("button", { name: "安排午晚餐", exact: true }).click();
  await choose(page);
  await editor(page).getByLabel("午餐每人餐费估算（元，选填）").fill("1.001");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(editor(page).getByRole("alert", { name: "用餐修改失败" })).toContainText(
    "餐费须为",
  );
  await editor(page).getByLabel("午餐每人餐费估算（元，选填）").fill("1.10");
  await editor(page).getByLabel("午餐饮食核对").selectOption("user_conflict");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(editor(page)).toContainText("完整行程位置已锁定");
  await expect(
    editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(0);
  await editor(page).press("Escape");
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
});

test("closing an in-flight meal query ignores late responses and explicit removal can be undone without re-querying unchanged visits", async ({
  page,
}) => {
  let calls = 0;
  let release: (() => void) | undefined;
  await page.route("**/api/routes", async (request) => {
    calls++;
    if (calls === 1) {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    await request.fulfill({ json: { route: walking } }).catch(() => undefined);
  });
  await openDraft(page);
  await choose(page);
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await expect(editor(page)).toContainText("正在查询用餐接驳");
  await expect.poll(() => calls).toBe(1);
  await editor(page).press("Escape");
  release?.();
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  await page.getByRole("button", { name: "安排午晚餐", exact: true }).click();
  await choose(page);
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  expect(calls).toBe(4);
  await page.getByRole("button", { name: "调整午晚餐", exact: true }).click();
  await editor(page)
    .getByRole("button", { name: "预览移除当天餐次", exact: true })
    .click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  expect(calls).toBe(4);
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(order(page)).toHaveCount(4);
  expect(calls).toBe(4);
});

test("replacing a confirmed draft restaurant only refreshes its two adjacent edges and can cancel or undo", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await page.route("**/api/routes", (request) => {
    calls.push(request.request().postDataJSON());
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page);
  await choose(page);
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  const replacement = {
    ...food[0],
    id: "meal-alternative",
    name: "测试备选餐厅",
    location: [120.17, 30.27],
  };
  await page.route("**/api/places?*", (request) =>
    request.fulfill({ json: { places: [replacement] } }),
  );
  for (const apply of [false, true]) {
    await page.getByRole("button", { name: "调整午晚餐", exact: true }).click();
    await editor(page).getByLabel("午餐餐厅关键词").fill("备选");
    await editor(page).getByRole("button", { name: "搜索午餐餐厅", exact: true }).click();
    await editor(page)
      .getByRole("button", { name: `午餐选择${replacement.name}`, exact: true })
      .click();
    await expect(editor(page).getByLabel("午餐每人餐费估算（元，选填）")).toHaveValue("");
    await expect(editor(page).getByLabel("午餐饮食核对")).toHaveValue("unknown");
    await editor(page).getByLabel("午餐每人餐费估算（元，选填）").fill("2.20");
    await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
    await expect(editor(page)).toContainText("需查询 2 段");
    await expect(order(page)).toContainText([
      places[0].name,
      food[0].name,
      places[1].name,
      food[1].name,
    ]);
    expect(calls).toHaveLength(3);
    if (!apply) {
      await editor(page).press("Escape");
      continue;
    }
    await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
    await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  }
  expect(calls.slice(3)).toEqual([
    { origin: places[0].location, destination: replacement.location },
    { origin: replacement.location, destination: places[1].location },
  ]);
  await expect(order(page)).toHaveText([
    places[0].name,
    `午餐 · ${replacement.name}`,
    places[1].name,
    `晚餐 · ${food[1].name}`,
  ]);
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(order(page)).toHaveText([
    places[0].name,
    `午餐 · ${food[0].name}`,
    places[1].name,
    `晚餐 · ${food[1].name}`,
  ]);
  expect(calls).toHaveLength(5);
});

test("visit reordering queries the actual dinner-to-visit leg, then removing meals explicitly queries the deferred bypass", async ({
  page,
}) => {
  const calls: unknown[] = [];
  await page.route("**/api/routes", (request) => {
    calls.push(request.request().postDataJSON());
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page);
  await choose(page);
  await editor(page).getByLabel("午餐插入位置").selectOption(places[1].id);
  await editor(page).getByLabel("午餐停留分钟").fill("30");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(editor(page)).toContainText("需查询 2 段");
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await page
    .getByRole("group", { name: `调整${places[0].name}`, exact: true })
    .getByRole("button", { name: "调整", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "调整行程", exact: true });
  await edit.getByLabel("当天顺序").selectOption("1");
  await edit.getByRole("button", { name: "预览修改", exact: true }).click();
  await expect(edit).toContainText("需要重新查询 1 段");
  await edit.getByRole("button", { name: "查询受影响路线", exact: true }).click();
  await edit.getByRole("button", { name: "确认修改", exact: true }).click();
  expect(calls).toHaveLength(3);
  expect(calls[2]).toEqual({ origin: food[1].location, destination: places[0].location });
  await expect(order(page)).toHaveText([
    places[1].name,
    `午餐 · ${food[0].name}`,
    `晚餐 · ${food[1].name}`,
    places[0].name,
  ]);
  await expect(page.locator(".timeline .stop-time")).toHaveText([
    "09:00",
    "11:30",
    "17:30",
    "19:05",
  ]);
  await page.getByRole("button", { name: "调整午晚餐", exact: true }).click();
  await editor(page)
    .getByRole("button", { name: "预览移除当天餐次", exact: true })
    .click();
  await expect(editor(page)).toContainText("需查询 1 段");
  expect(calls).toHaveLength(3);
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  expect(calls[3]).toEqual({
    origin: places[1].location,
    destination: places[0].location,
  });
  await expect(order(page)).toHaveText([places[1].name, places[0].name]);
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(order(page)).toHaveText([
    places[1].name,
    `午餐 · ${food[0].name}`,
    `晚餐 · ${food[1].name}`,
    places[0].name,
  ]);
  expect(calls).toHaveLength(4);
});

test("complete-trip meal prefill replaces rather than adds, retains scope/other fees, previews, cancels and undoes", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page);
  await confirmMealDay(page);
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  const budget = budgetDialog(page);
  await expect(
    budget.getByRole("button", { name: "使用全程午晚餐估算", exact: true }),
  ).toBeDisabled();
  await expect(budget).toContainText("全程午晚餐或餐费尚未齐全");
  await budget.getByLabel("餐饮估算（元）").fill("10");
  await budget.getByLabel("餐饮口径").selectOption("trip");
  await budget.getByLabel("市内交通估算（元）").fill("1.10");
  await budget.getByLabel("市内交通口径").selectOption("trip");
  await budget.getByLabel("计入跨城往返").uncheck();
  await budget.getByRole("button", { name: "预览费用", exact: true }).click();
  await budget.getByRole("button", { name: "确认费用", exact: true }).click();
  await secondMealDay(page);
  const saved = page.locator(".saved-budget");
  await expect(saved).toContainText("11.10");
  for (const apply of [false, true]) {
    await page.getByRole("button", { name: "填写费用", exact: true }).click();
    await expect(budget.getByLabel("餐饮估算（元）")).toHaveValue("10.00");
    await budget.getByRole("button", { name: "使用全程午晚餐估算", exact: true }).click();
    await expect(budget.getByLabel("餐饮估算（元）")).toHaveValue("2.20");
    await expect(budget.getByLabel("餐饮口径")).toHaveValue("per_person");
    await expect(budget.getByLabel("市内交通估算（元）")).toHaveValue("1.10");
    await expect(budget.getByLabel("市内交通口径")).toHaveValue("trip");
    await expect(budget.getByLabel("计入跨城往返")).not.toBeChecked();
    const group = budget.getByRole("group", { name: "全程午晚餐预填", exact: true });
    await group.scrollIntoViewIfNeeded();
    expect(
      await group.evaluate((node) => {
        const button = node.querySelector("button")!.getBoundingClientRect();
        let end = button.bottom;
        return [...node.querySelectorAll("p")].every((item) => {
          const box = item.getBoundingClientRect();
          const valid = box.top >= end;
          end = box.bottom;
          return valid;
        });
      }),
    ).toBe(true);
    await expect(group).toContainText("不含早餐、零食和饮品");
    if (!apply) {
      await budget.press("Escape");
      await expect(saved).toContainText("11.10");
      continue;
    }
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-meal-budget-prefill.png`,
      caret: "initial",
    });
    await budget.getByRole("button", { name: "预览费用", exact: true }).click();
    await expect(saved).toContainText("11.10");
    await expect(budget).toContainText("5.50");
    await budget.getByRole("button", { name: "确认费用", exact: true }).click();
  }
  await expect(saved).toContainText("5.50");
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(saved).toContainText("11.10");
  await expect(order(page)).toHaveCount(4);
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  await budget.getByRole("button", { name: "使用全程午晚餐估算", exact: true }).click();
  await budget.getByRole("button", { name: "预览费用", exact: true }).click();
  await budget.getByRole("button", { name: "确认费用", exact: true }).click();
  await page.getByRole("button", { name: "调整午晚餐", exact: true }).click();
  await editor(page).getByLabel("晚餐每人餐费估算（元，选填）").fill("4.40");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await expect(saved).toContainText("5.50");
  expect(calls).toBe(6);
});

test("missing meal price remains unknown; explicit zero can prefill without claiming free meals or changing other form entries", async ({
  page,
}) => {
  await page.route("**/api/routes", (request) =>
    request.fulfill({ json: { route: walking } }),
  );
  await openDraft(page);
  await confirmMealDay(page, "0", "0");
  await secondMealDay(page, "0", "");
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  const budget = budgetDialog(page);
  await expect(
    budget.getByRole("button", { name: "使用全程午晚餐估算", exact: true }),
  ).toBeDisabled();
  await budget.press("Escape");
  await page.getByRole("button", { name: "调整午晚餐", exact: true }).click();
  await editor(page).getByLabel("晚餐每人餐费估算（元，选填）").fill("0");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  await budget.getByLabel("跨城往返估算（元）").fill("20");
  await budget.getByLabel("计入跨城往返").uncheck();
  await budget.getByLabel("餐饮估算（元）").fill("37");
  await budget.getByLabel("餐饮口径").selectOption("trip");
  await budget.getByRole("button", { name: "使用全程午晚餐估算", exact: true }).click();
  await expect(budget.getByLabel("餐饮估算（元）")).toHaveValue("0.00");
  await expect(budget.getByLabel("餐饮口径")).toHaveValue("per_person");
  await expect(budget.getByLabel("跨城往返估算（元）")).toHaveValue("20");
  await expect(budget.getByLabel("计入跨城往返")).not.toBeChecked();
  await expect(budget).toContainText("明确零元不代表免费");
  await budget.getByRole("button", { name: "预览费用", exact: true }).click();
  await budget.getByRole("button", { name: "确认费用", exact: true }).click();
  await expect(page.locator(".saved-budget")).toContainText("0.00");
  await expect(page.locator(".saved-budget")).toContainText("还有未知费用");
});

test("over-limit full-trip meal totals disable prefill rather than truncate or overwrite estimates", async ({
  page,
}) => {
  await page.route("**/api/routes", (request) =>
    request.fulfill({ json: { route: walking } }),
  );
  await openDraft(page);
  await confirmMealDay(page, "60000", "60000");
  await secondMealDay(page, "60000", "60000");
  await page.getByRole("button", { name: "填写费用", exact: true }).click();
  const budget = budgetDialog(page);
  await budget.getByLabel("餐饮估算（元）").fill("10");
  await expect(
    budget.getByRole("button", { name: "使用全程午晚餐估算", exact: true }),
  ).toBeDisabled();
  await expect(budget).toContainText("超出单项十万元上限，不能预填或截断金额");
  await expect(budget.getByLabel("餐饮估算（元）")).toHaveValue("10");
});

test("user venue facts preview with independent provenance, show in details and constrain later visit edits", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page);
  await choose(page);
  await recordLunchVenue(page);
  await editor(page)
    .getByLabel("午餐规则适用日期", { exact: true })
    .scrollIntoViewIfNeeded();
  expect(
    await editor(page).evaluate((node) => {
      const bounds = node.getBoundingClientRect();
      return [...node.querySelectorAll("input")].every((input) => {
        const box = input.getBoundingClientRect();
        return box.left >= bounds.left && box.right <= bounds.right;
      });
    }),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-meal-venue-form.png`,
    caret: "initial",
  });
  await editor(page)
    .getByLabel("午餐预约入场开始（选填）", { exact: true })
    .scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-meal-venue-windows.png`,
    caret: "initial",
  });
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  const after = editor(page).getByRole("region", { name: "调整后营业预约", exact: true });
  await expect(after).toContainText("10:00—14:00");
  await expect(after).toContainText("[11:30, 12:00)");
  await expect(after).toContainText("用户记录已预约，非平台核验");
  const clock = await after.getByText(/用户记录（UTC）/).textContent();
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "确认用餐安排", exact: true }),
  ).toBeEnabled();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-meal-venue-preview.png`,
    caret: "initial",
  });
  await after.scrollIntoViewIfNeeded();
  expect(
    await after.evaluate((node) => {
      const box = node.getBoundingClientRect();
      const dialog = node.closest("dialog")!.getBoundingClientRect();
      return (
        box.top >= dialog.top &&
        box.bottom <= dialog.bottom &&
        box.left >= dialog.left &&
        box.right <= dialog.right
      );
    }),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-meal-venue-facts.png`,
    caret: "initial",
  });
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await page
    .locator(".timeline .stop-card")
    .filter({ hasText: `午餐 · ${food[0].name}` })
    .click();
  const details =
    testInfo.project.name === "mobile"
      ? page.getByRole("dialog", { name: "地点详情", exact: true })
      : page.getByRole("complementary", { name: "地点详情", exact: true });
  await expect(
    details.getByRole("region", { name: "所选餐次营业预约", exact: true }),
  ).toContainText("10:00—14:00");
  if (testInfo.project.name === "mobile") {
    await details.getByRole("button", { name: "关闭地点详情", exact: true }).click();
  }
  await page.getByRole("button", { name: "调整午晚餐", exact: true }).click();
  await editor(page).getByLabel("午餐每人餐费估算（元，选填）").fill("2.20");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(
    editor(page)
      .getByRole("region", { name: "调整后营业预约", exact: true })
      .getByText(/用户记录（UTC）/),
  ).toHaveText(clock!);
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await page
    .getByRole("group", { name: `调整${places[0].name}`, exact: true })
    .getByRole("button", { name: "调整", exact: true })
    .click();
  const edit = page.getByRole("dialog", { name: "调整行程", exact: true });
  await edit.getByLabel("停留时间（分钟）").fill("150");
  await edit.getByRole("button", { name: "预览修改", exact: true }).click();
  await expect(
    edit.getByRole("button", { name: "确认修改", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(3);
});

test("closed, too-short opening and exclusive reservation end block queries while unknown stays explicit", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page);
  await choose(page);
  await recordLunchVenue(page);
  await editor(page).getByLabel("午餐营业状态", { exact: true }).selectOption("closed");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(
    editor(page).getByRole("region", { name: "调整后营业预约", exact: true }),
  ).toContainText("当天闭店");
  await expect(
    editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }),
  ).toBeDisabled();
  await editor(page).getByRole("button", { name: "返回填写", exact: true }).click();
  await editor(page).getByLabel("午餐营业状态", { exact: true }).selectOption("windows");
  await editor(page)
    .getByLabel("午餐营业时段 1 结束", { exact: true })
    .fill("2026-10-17T12:00");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }),
  ).toBeDisabled();
  await editor(page).getByRole("button", { name: "返回填写", exact: true }).click();
  await editor(page)
    .getByLabel("午餐营业时段 1 结束", { exact: true })
    .fill("2026-10-17T14:00");
  await editor(page)
    .getByLabel("午餐预约入场开始（选填）", { exact: true })
    .fill("2026-10-17T11:00");
  await editor(page)
    .getByLabel("午餐预约入场结束（选填）", { exact: true })
    .fill("2026-10-17T11:30");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }),
  ).toBeDisabled();
  await editor(page).getByRole("button", { name: "返回填写", exact: true }).click();
  await editor(page).getByLabel("午餐预约状态", { exact: true }).selectOption("unknown");
  await editor(page).getByLabel("午餐营业状态", { exact: true }).selectOption("unknown");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(
    editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }),
  ).toBeEnabled();
  await expect(editor(page)).toContainText("当天营业窗口未知");
  expect(calls).toBe(0);
  await expect(order(page)).toHaveCount(2);
});

test("recorded reservation changes and meal removal require explicit acknowledgement, remain previews and undo", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    return request.fulfill({ json: { route: walking } });
  });
  await openDraft(page);
  await choose(page);
  await recordLunchVenue(page);
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await editor(page).getByRole("button", { name: "查询用餐接驳", exact: true }).click();
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await page.getByRole("button", { name: "调整午晚餐", exact: true }).click();
  await editor(page).getByLabel("午餐预约状态", { exact: true }).selectOption("unknown");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("原预约为强约束");
  const acknowledgement = editor(page).getByLabel(/我已核对午餐原预约变更／移除/);
  await acknowledgement.check();
  await editor(page)
    .getByLabel("午餐预约状态", { exact: true })
    .selectOption("not_required");
  await expect(acknowledgement).not.toBeChecked();
  await editor(page).getByLabel("午餐预约状态", { exact: true }).selectOption("unknown");
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(editor(page).getByRole("alert")).toContainText("原预约为强约束");
  await acknowledgement.check();
  await editor(page).getByRole("button", { name: "预览用餐安排", exact: true }).click();
  await expect(
    editor(page).getByRole("region", { name: "当前营业预约", exact: true }),
  ).toContainText("用户记录已预约");
  await expect(
    editor(page).getByRole("region", { name: "调整后营业预约", exact: true }),
  ).toContainText("未知，尚未核对");
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await page.getByRole("button", { name: "调整午晚餐", exact: true }).click();
  await expect(editor(page).getByLabel("午餐预约状态", { exact: true })).toHaveValue(
    "confirmed",
  );
  await editor(page)
    .getByRole("button", { name: "预览移除当天餐次", exact: true })
    .click();
  await expect(editor(page).getByRole("alert")).toContainText("先明确核对原预约");
  await editor(page)
    .getByLabel(/我已核对午餐原预约变更／移除/)
    .check();
  await editor(page)
    .getByRole("button", { name: "预览移除当天餐次", exact: true })
    .click();
  await expect(order(page)).toHaveCount(4);
  await editor(page).getByRole("button", { name: "确认用餐安排", exact: true }).click();
  await expect(order(page)).toHaveCount(2);
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(order(page)).toHaveCount(4);
  expect(calls).toBe(3);
});
