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

async function openDraft(page: Page) {
  await page.route("**/api/plans", (request) =>
    request.fulfill({ json: { draft: fixtureDraft() } }),
  );
  await page.goto("/manual");
  await addFixturePlaces(page);
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("heading", { name: "测试城市2日路线草稿" })).toBeVisible();
}
const controls = (page: Page, index: number) =>
  page.getByRole("group", { name: `调整${places[index].name}`, exact: true });
const editor = (page: Page) =>
  page.getByRole("dialog", { name: "调整行程", exact: true });
const order = (page: Page) => page.locator(".timeline .stop-card strong");

async function editFirst(page: Page) {
  await controls(page, 0).getByRole("button", { name: "调整", exact: true }).click();
  await expect(editor(page)).toBeVisible();
}

test("duration preview is isolated until confirmation, and undo needs no route request", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    return request.fulfill({ json: { route } });
  });
  await openDraft(page);
  await editFirst(page);
  await page.getByLabel("停留时间（分钟）").fill("120");
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await expect(page.locator(".timeline .stop-card").first()).toContainText(
    "停留 90 分钟",
  );
  await expect(editor(page)).toContainText("停留 120 分钟");
  await expect(
    editor(page).getByRole("button", { name: "查询受影响路线" }),
  ).not.toBeVisible();
  expect(calls).toBe(0);
  const bounds = await editor(page).boundingBox();
  expect(bounds).not.toBeNull();
  if (testInfo.project.name === "desktop") {
    expect(bounds!.width).toBeGreaterThan(600);
  } else {
    expect(bounds!.width).toBeLessThanOrEqual(390);
  }
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-edit-preview.png`,
    fullPage: true,
    caret: "initial",
  });
  await editor(page).getByRole("button", { name: "确认修改" }).click();
  await expect(editor(page)).not.toBeVisible();
  await expect(page.locator(".timeline .stop-card").first()).toContainText(
    "停留 120 分钟",
  );
  await expect(
    controls(page, 0).getByRole("button", { name: "调整", exact: true }),
  ).toBeFocused();
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(page.locator(".timeline .stop-card").first()).toContainText(
    "停留 90 分钟",
  );
  await expect(
    page.getByRole("button", { name: "撤销修改", exact: true }),
  ).toBeDisabled();
  expect(calls).toBe(0);
});

test("reorder queries only a changed directed leg, preserves the plan on failure and allows explicit retry", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/routes", (request) => {
    calls++;
    expect(request.request().postDataJSON()).toEqual({
      origin: places[1].location,
      destination: places[0].location,
    });
    return request.fulfill(
      calls === 1
        ? { status: 503, json: { message: "测试步行服务不可用。" } }
        : { json: { route } },
    );
  });
  await openDraft(page);
  await editFirst(page);
  await page.getByLabel("当天顺序").selectOption("1");
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  expect(calls).toBe(0);
  await editor(page).getByRole("button", { name: "查询受影响路线" }).click();
  await expect(editor(page).getByRole("alert", { name: "行程修改失败" })).toContainText(
    "测试步行服务不可用",
  );
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  expect(calls).toBe(1);
  await editor(page).getByRole("button", { name: "查询受影响路线" }).click();
  await editor(page).getByRole("button", { name: "确认修改" }).click();
  await expect(order(page)).toHaveText([places[1].name, places[0].name]);
  expect(calls).toBe(2);
  await page.getByRole("button", { name: "撤销修改", exact: true }).click();
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  expect(calls).toBe(2);
});

test("position and time locks are retained and conflicting changes cannot be confirmed", async ({
  page,
}) => {
  await openDraft(page);
  await controls(page, 1).getByRole("button", { name: "锁定位置" }).click();
  await editFirst(page);
  await page.getByLabel("当天顺序").selectOption("1");
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await expect(editor(page)).toContainText("日期与顺序位置已锁定");
  await expect(
    editor(page).getByRole("button", { name: "查询受影响路线" }),
  ).toBeDisabled();
  await page.keyboard.press("Escape");
  await expect(
    controls(page, 0).getByRole("button", { name: "调整", exact: true }),
  ).toBeFocused();
  await controls(page, 1).getByRole("button", { name: "位置已锁" }).click();
  await controls(page, 1).getByRole("button", { name: "锁定时间" }).click();
  await editFirst(page);
  await page.getByLabel("停留时间（分钟）").fill("240");
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await expect(editor(page)).toContainText("无法保证");
  await expect(editor(page).getByRole("button", { name: "确认修改" })).toBeDisabled();
  await editor(page).getByRole("button", { name: "返回调整" }).click();
  await page.getByLabel("停留时间（分钟）").fill("15");
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await editor(page).getByRole("button", { name: "确认修改" }).click();
  await expect(
    controls(page, 1).getByRole("button", { name: "时间已锁" }),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator(".timeline .stop-card").nth(1)).toContainText("11:05");
});

test("closing a pending route request aborts it and late data does not overwrite the draft", async ({
  page,
}) => {
  let release = () => {};
  let entered = () => {};
  const waiting = new Promise<void>((resolve) => {
    release = resolve;
  });
  const received = new Promise<void>((resolve) => {
    entered = resolve;
  });
  await page.route("**/api/routes", async (request) => {
    entered();
    await waiting;
    await request.fulfill({ json: { route } });
  });
  await openDraft(page);
  await editFirst(page);
  await page.getByLabel("当天顺序").selectOption("1");
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await editor(page).getByRole("button", { name: "查询受影响路线" }).click();
  await received;
  const aborted = page.waitForEvent("requestfailed", (request) =>
    request.url().endsWith("/api/routes"),
  );
  await page.keyboard.press("Escape");
  await aborted;
  release();
  await expect(editor(page)).not.toBeVisible();
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  await expect(
    controls(page, 0).getByRole("button", { name: "调整", exact: true }),
  ).toBeFocused();
  await editFirst(page);
  await page.getByLabel("停留时间（分钟）").fill("120");
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await editor(page).getByRole("button", { name: "确认修改" }).click();
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  await expect(page.locator(".timeline .stop-card").first()).toContainText(
    "停留 120 分钟",
  );
});

test("desktop drag and the narrow-screen button alternative both enter a preview", async ({
  page,
}, testInfo) => {
  await openDraft(page);
  if (testInfo.project.name === "desktop") {
    await page
      .locator(".timeline .stop-card")
      .first()
      .dragTo(page.locator(".timeline .stop-card").nth(1));
  } else {
    await editFirst(page);
    await page.getByLabel("当天顺序").selectOption("1");
  }
  await expect(editor(page)).toBeVisible();
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await expect(editor(page)).toContainText("需要重新查询 1 段");
  await expect(order(page)).toHaveText([places[0].name, places[1].name]);
  await page.keyboard.press("Escape");
});

test("cross-day changes keep explicit grouping and retry only a still-failed leg", async ({
  page,
}) => {
  const pairs: unknown[] = [];
  await page.route("**/api/routes", (request) => {
    pairs.push(request.request().postDataJSON());
    return request.fulfill(
      pairs.length === 2
        ? { status: 503, json: { message: "第二段暂不可用。" } }
        : { json: { route } },
    );
  });
  await openDraft(page);
  await editFirst(page);
  await page.getByLabel("安排日期").selectOption("1");
  await page.getByLabel("当天顺序").selectOption("1");
  await editor(page).getByRole("button", { name: "预览修改" }).click();
  await editor(page).getByRole("button", { name: "查询受影响路线" }).click();
  await expect(editor(page).getByRole("alert", { name: "行程修改失败" })).toContainText(
    "第二段暂不可用",
  );
  await editor(page).getByRole("button", { name: "查询受影响路线" }).click();
  await editor(page).getByRole("button", { name: "确认修改" }).click();
  await expect(order(page)).toHaveText([places[2].name, places[0].name, places[3].name]);
  await expect(
    controls(page, 0).getByRole("button", { name: "调整", exact: true }),
  ).toBeFocused();
  expect(pairs).toEqual([
    { origin: places[2].location, destination: places[0].location },
    { origin: places[0].location, destination: places[3].location },
    { origin: places[0].location, destination: places[3].location },
  ]);
  await page.getByRole("button", { name: "第 1 天", exact: true }).click();
  await expect(order(page)).toHaveText([places[1].name]);
});
