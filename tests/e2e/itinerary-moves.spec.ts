import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { route as fixtureRoute } from "../fixtures/draft";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";
import { routeInputSchema } from "../../src/lib/contracts";

async function setup(page: Page, days = 2) {
  await page.route("**/api/itineraries", (intercept) =>
    intercept.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        type: "result",
        plan: fixtureItinerary(tripBriefSchema.parse(intercept.request().postDataJSON())),
      }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill(String(days));
  await page.getByLabel("同行人数").fill("20");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
}
async function move(page: Page, day = 0) {
  await page
    .getByRole("button", { name: "查看测试文化场馆1的资料", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "测试文化场馆1", exact: true });
  await dialog.getByText("顺序与跨天调整", { exact: true }).click();
  await dialog.getByLabel("移动到日期").selectOption(String(day));
  await dialog.getByLabel("插入位置").selectOption("3");
  await dialog.getByRole("button", { name: "预览新位置", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("#trip-review-heading")).toBeFocused();
}
async function order(page: Page) {
  return page
    .getByRole("region", { name: "当日完整安排" })
    .locator(".trip-place-select")
    .allTextContents()
    .then((values) => values.map((value) => value.trim()));
}

test("reorder previews three actual directed neighbors, retains partial successes and only retries missing routes before confirm and undo", async ({
  page,
}, testInfo) => {
  const requests: string[] = [];
  await page.route("**/api/routes", (intercept) => {
    requests.push(
      JSON.stringify(routeInputSchema.parse(intercept.request().postDataJSON())),
    );
    return requests.length === 2
      ? intercept.fulfill({
          status: 503,
          json: { code: "unavailable", message: "测试路线暂不可用" },
        })
      : intercept.fulfill({ json: { route: fixtureRoute } });
  });
  await setup(page);
  await move(page);
  const panel = page.getByRole("region", { name: "受影响的步行路线" });
  await expect(panel.getByRole("status")).toHaveText("已查询 0／3 段");
  await expect(page.getByRole("button", { name: "确认此项修改" })).toBeDisabled();
  expect(requests).toHaveLength(0);
  await panel.getByRole("button", { name: "查询受影响路线" }).click();
  await expect(panel.getByRole("alert")).toContainText("测试路线暂不可用");
  await expect(panel.getByRole("status")).toHaveText("已查询 1／3 段");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await panel.getByRole("button", { name: "补查剩余路线" }).click();
  await expect(panel.getByRole("status")).toHaveText("已查询 3／3 段");
  expect(requests).toHaveLength(4);
  expect(requests.filter((value) => value === requests[0])).toHaveLength(1);
  expect(requests[1]).toBe(requests[2]);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-full-move-preview.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  expect(await order(page)).toEqual([
    "测试早餐店",
    "测试午餐店",
    "测试文化场馆2",
    "测试文化场馆1",
    "测试晚餐店",
  ]);
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
  expect(await order(page)).toEqual([
    "测试早餐店",
    "测试文化场馆1",
    "测试午餐店",
    "测试文化场馆2",
    "测试晚餐店",
  ]);
  expect(requests).toHaveLength(4);
});

test("cross-day move reaches day fourteen for twenty travelers and moves its explanation and timeline with explicit local routes", async ({
  page,
}, testInfo) => {
  let requests = 0;
  await page.route("**/api/routes", (intercept) => {
    requests += 1;
    return intercept.fulfill({ json: { route: fixtureRoute } });
  });
  await setup(page, 14);
  await move(page, 13);
  await expect(page.getByRole("region", { name: "活动修改差异" })).toContainText(
    "第 1 天第 2 项 → 第 14 天第 4 项",
  );
  await page.getByRole("button", { name: "查询受影响路线" }).click();
  await expect(
    page.getByRole("region", { name: "受影响的步行路线" }).getByRole("status"),
  ).toHaveText("已查询 3／3 段");
  await page.getByRole("button", { name: /第 14 天/ }).click();
  expect(await order(page)).toContain("测试文化场馆1");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-full-cross-day-move.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  expect(await order(page)).toEqual([
    "测试早餐店",
    "测试文化场馆27",
    "测试午餐店",
    "测试文化场馆1",
    "测试文化场馆28",
    "测试晚餐店",
  ]);
  await page
    .getByRole("button", { name: "查看测试文化场馆1的资料", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("测试街区1号");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  expect(await order(page)).not.toContain("测试文化场馆1");
  await page.getByRole("button", { name: /第 1 天/ }).click();
  expect(await order(page)).toContain("测试文化场馆1");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
  expect(requests).toBe(3);
});

test("native desktop drag and keyboard handle use the same isolated preview as the mobile form, ignoring external drops", async ({
  page,
}, testInfo) => {
  let requests = 0;
  await page.route("**/api/routes", (intercept) => {
    requests += 1;
    return intercept.abort();
  });
  await setup(page);
  const handle = page.getByRole("button", {
    name: "调整测试文化场馆1的位置",
    exact: true,
  });
  const target = page
    .getByRole("article")
    .filter({ has: page.getByRole("button", { name: "测试文化场馆2", exact: true }) });
  if (testInfo.project.name === "desktop") {
    // Start a trusted native drag before scrolling an initially off-screen target.
    // dragTo scrolls the target before its first mouse move, which can lose this gesture.
    await handle.evaluate((element) =>
      element.addEventListener(
        "dragstart",
        (event) => {
          if (event.isTrusted) {
            element.setAttribute("data-native-drag-started", "true");
          }
        },
        { once: true },
      ),
    );
    await handle.scrollIntoViewIfNeeded();
    const source = await handle.boundingBox();
    await page.mouse.move(source!.x + source!.width / 2, source!.y + source!.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      source!.x + source!.width / 2 + 14,
      source!.y + source!.height / 2 + 2,
      { steps: 4 },
    );
    await expect(handle).toHaveAttribute("data-native-drag-started", "true");
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    await page.mouse.move(box!.x + 30, box!.y + box!.height - 10, { steps: 6 });
    await page.mouse.up();
  } else {
    await expect(handle).toHaveCount(0);
    await move(page);
  }
  await expect(page.getByRole("region", { name: "活动修改差异" })).toContainText(
    "第 1 天第 2 项 → 第 1 天第 4 项",
  );
  await expect(page.getByRole("button", { name: "确认此项修改" })).toBeDisabled();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  expect(requests).toBe(0);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-full-native-move-preview.png`,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "保留原方案" }).click();
  if (testInfo.project.name === "desktop") {
    await handle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog").getByLabel("移动到日期")).toBeVisible();
    await expect(page.getByRole("dialog").getByLabel("插入位置")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(handle).toBeFocused();
    await page.keyboard.press("Space");
    await expect(page.getByRole("dialog").getByLabel("插入位置")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(handle).toBeFocused();
  }
  const external = await page.evaluateHandle(() => {
    const transfer = new DataTransfer();
    transfer.setData("application/x-xingjian-activity", "activity:trip-0-1");
    return transfer;
  });
  await target.dispatchEvent("drop", { dataTransfer: external });
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "未应用外部拖入的内容",
  );
  await expect(page.getByRole("region", { name: "新方案确认" })).toHaveCount(0);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  expect(requests).toBe(0);
  await external.dispose();
});

test("cancelling an in-flight move ignores late data even after reopening the same operation at the same version", async ({
  page,
}) => {
  let release!: () => void;
  let finished!: () => void;
  let requests = 0;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const done = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route("**/api/routes", async (intercept) => {
    requests += 1;
    if (requests === 1) {
      await gate;
      try {
        await intercept.fulfill({ json: { route: fixtureRoute } });
      } catch {
        /* Expected if the cancelled fetch has already been disposed. */
      } finally {
        finished();
      }
    } else {
      await intercept.fulfill({ json: { route: fixtureRoute } });
    }
  });
  await setup(page);
  await move(page);
  await page.getByRole("button", { name: "查询受影响路线" }).click();
  await expect.poll(() => requests).toBe(1);
  await page.getByRole("button", { name: "保留原方案" }).click();
  await move(page);
  release();
  await done;
  await expect(
    page.getByRole("region", { name: "受影响的步行路线" }).getByRole("status"),
  ).toHaveText("已查询 0／3 段");
  await expect(page.getByRole("button", { name: "确认此项修改" })).toBeDisabled();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.getByRole("button", { name: "保留原方案" }).click();
  expect(await order(page)).toEqual([
    "测试早餐店",
    "测试文化场馆1",
    "测试午餐店",
    "测试文化场馆2",
    "测试晚餐店",
  ]);
  expect(requests).toBe(1);
});
