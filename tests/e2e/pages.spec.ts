import { test, expect } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

test("home, planning and current itinerary are distinct routes with keyboard navigation and no automatic requests", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /你的下一站，\s*值得好好期待。/ }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("navigation", { name: "主导航" })
      .getByRole("link", { name: "首页", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-travel-home.png`,
    fullPage: true,
    animations: "disabled",
  });
  const caption = (await page.locator(".travel-paper-bottom").boundingBox())!;
  const note = (await page.locator(".travel-paper-note").boundingBox())!;
  expect(note.y).toBeGreaterThanOrEqual(caption.y + caption.height);
  const visual = page.locator(".travel-paper-front");
  if (testInfo.project.name === "desktop") {
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.locator(".travel-paper-art").hover();
    const hover = expect.poll(() =>
      visual.evaluate((element) => {
        const matrix = new DOMMatrix(getComputedStyle(element).transform);
        return Math.abs(matrix.m12) < 0.001 && Math.abs(matrix.m42 + 4) < 0.1;
      }),
    );
    await hover.toBe(true);
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  const motion = await visual.evaluate((element) => {
    const style = getComputedStyle(element);
    return { animation: style.animationName, transition: style.transitionDuration };
  });
  expect(motion.animation).toBe("none");
  expect(
    motion.transition
      .split(",")
      .every((duration) => Number.parseFloat(duration) <= 0.001),
  ).toBe(true);
  const widths = testInfo.project.name === "desktop" ? [1536, 960] : [390, 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 1000 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    const footer = (await page.locator(".travel-paper-bottom").boundingBox())!;
    const stickyNote = (await page.locator(".travel-paper-note").boundingBox())!;
    expect(stickyNote.y).toBeGreaterThanOrEqual(footer.y + footer.height);
    const bounds = await visual.evaluate((element) => {
      const frame = element.getBoundingClientRect();
      const children = [...element.children].map((child) =>
        child.getBoundingClientRect(),
      );
      return {
        frameBottom: frame.bottom,
        contentBottom: Math.max(...children.map((child) => child.bottom)),
      };
    });
    expect(bounds.contentBottom).toBeLessThan(bounds.frameBottom);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-paper-home-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  const current = page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "当前行程", exact: true });
  await current.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/itinerary$/);
  await expect(page.getByRole("heading", { name: "还没有当前行程" })).toBeVisible();
  await page.getByRole("link", { name: "新建旅行规划", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByLabel("目的地城市")).toBeVisible();
  expect(calls).toBe(0);
});

test("paper home has native skip-to-action focus, working AI and manual entries and no automatic generation", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/");
  const skip = page.getByRole("link", { name: "跳到主要内容", exact: true });
  await expect(skip).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  await page.keyboard.press("Tab");
  const start = page.getByRole("link", { name: "开始规划", exact: true });
  await expect(start).toBeFocused();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-paper-home-focus.png`,
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByLabel("目的地城市")).toBeVisible();
  await page.goto("/explore");
  await expect(page.getByRole("heading", { name: /你的下一站/ })).toBeVisible();
  await page
    .getByRole("region", { name: "选择规划方式" })
    .getByRole("link", {
      name: "想亲自选择地点 在工作台里手动选点",
      exact: true,
    })
    .focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/plan\?mode=manual$/);
  expect(calls).toBe(0);
});

test("the shared skip link reaches the current-itinerary main region and its next action by native keyboard", async ({
  page,
}) => {
  await page.goto("/itinerary");
  const skip = page.getByRole("link", { name: "跳到主要内容", exact: true });
  await expect(skip).toHaveCount(1);
  await page.keyboard.press("Tab");
  await expect(skip).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main#main")).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "新建旅行规划", exact: true }),
  ).toBeFocused();
});

test("leaving an edited brief requires explicit discard and never starts generation", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("尚未提交的城市");
  const home = page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "首页", exact: true });
  page.once("dialog", (dialog) => dialog.dismiss());
  await home.click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByLabel("目的地城市")).toHaveValue("尚未提交的城市");
  page.once("dialog", (dialog) => dialog.accept());
  await home.click();
  await expect(page).toHaveURL("/");
  expect(calls).toBe(0);
});

test("AI planning stays in the unified workspace, keeps the proposal across soft navigation and does not pretend a refresh saved it", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        type: "result",
        plan: fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON())),
      }),
    });
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("1");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await expect(
    page.getByRole("heading", { name: "在城市的文化与烟火之间" }),
  ).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "首页", exact: true })
    .click();
  await expect(page).toHaveURL("/");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "当前行程", exact: true })
    .click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.getByRole("button", { name: "调整旅行需求" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByLabel("目的地城市")).toHaveValue("测试城市");
  await page.getByRole("button", { name: "返回当前方案" }).click();
  await expect(page).toHaveURL(/\/plan$/);
  expect(calls).toBe(1);
  await page
    .getByRole("button", { name: "查看测试文化场馆1的资料", exact: true })
    .click();
  await page.getByLabel("建议停留（分钟）").fill("45");
  await page.getByRole("button", { name: "预览停留调整" }).click();
  await expect(page.getByRole("region", { name: "活动修改差异" })).toBeVisible();
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "首页", exact: true })
    .click();
  await page.getByRole("link", { name: "开始规划", exact: true }).click();
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.getByRole("main").getByRole("alert")).toContainText("尚未确认的预览");
  expect(calls).toBe(1);
  await page.getByRole("button", { name: "返回当前方案" }).click();
  await expect(page.getByRole("region", { name: "活动修改差异" })).toBeVisible();
  await page.getByRole("button", { name: "保留原方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page
    .getByRole("navigation", { name: "主导航" })
    .getByRole("link", { name: "当前行程", exact: true })
    .click();
  await expect(page).toHaveURL(/\/itinerary$/);
  await page.reload();
  await expect(page.getByRole("heading", { name: "还没有当前行程" })).toBeVisible();
  await expect(page.getByText(/刷新会清空/)).toBeVisible();
  await page.goto("/");
  await expect(page.getByRole("heading", { name: /你的下一站/ })).toBeVisible();
  expect(calls).toBe(1);
});
