import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";
import { tripPurposeLabels } from "../../src/domain/trip-brief";

async function fill(page: Page, days = 2, travelers = 2) {
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill(String(days));
  await page.getByLabel("同行人数").fill(String(travelers));
  await page.getByLabel("预算金额（元）").fill("1.10");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
}
async function generate(page: Page) {
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
}
async function geometry(page: Page) {
  const invalid = await page
    .locator(".trip-fields input, .trip-fields select, .trip-fields textarea")
    .evaluateAll((elements) =>
      elements
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          return (
            rect.width > 0 &&
            (rect.x < 0 ||
              rect.right > innerWidth + 1 ||
              rect.width < 100 ||
              rect.height < 40)
          );
        })
        .map((element) => element.outerHTML),
    );
  expect(invalid).toEqual([]);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
}
for (const [days, travelers] of [
  [1, 1],
  [14, 20],
]) {
  test(`full brief to daily proposal supports ${days} days and ${travelers} travelers without preselected places`, async ({
    page,
  }, testInfo) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let calls = 0;
    await page.route("**/api/itineraries", (route) => {
      calls += 1;
      const brief = tripBriefSchema.parse(route.request().postDataJSON());
      expect(brief.dayCount).toBe(days);
      expect(brief.travelers).toBe(travelers);
      expect(brief.mustVisit).toEqual([]);
      expect(brief.mustEat).toEqual([]);
      expect(brief.mainPurpose).toBe("nature");
      expect(brief.budget.amountFen).toBe(110);
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: `${JSON.stringify({ type: "progress", message: "正在核对真实邻段（fixture）" })}\n${JSON.stringify({ type: "result", plan: fixtureItinerary(brief) })}\n`,
      });
    });
    await page.goto("/plan");
    await expect(page.getByRole("heading", { name: "规划旅行" })).toBeVisible();
    await generate(page);
    await expect(page.getByRole("main").getByRole("alert")).toBeVisible();
    await expect(page.getByLabel("目的地城市")).toBeFocused();
    expect(calls).toBe(0);
    await fill(page, days, travelers);
    await expect(page.getByRole("main").getByRole("alert")).toHaveCount(0);
    await page.getByLabel("出发日期").fill("2026-12-31");
    await page.getByRole("button", { name: "偏好与必去", exact: true }).click();
    await page
      .getByRole("button", { name: tripPurposeLabels.nature, exact: true })
      .click();
    await geometry(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    if (days === 1) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `test-results/${testInfo.project.name}-full-brief-viewport.png`,
      });
      await page.screenshot({
        path: `test-results/${testInfo.project.name}-full-brief.png`,
        fullPage: true,
      });
    }
    await generate(page);
    const heading = page.getByRole("heading", {
      name: "在城市的文化与烟火之间",
      exact: true,
    });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(
      page.getByText("测试 fixture：此方案用于离线交互验证，不是真实接口规划结果。"),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "选择行程日期" }).getByRole("tab"),
    ).toHaveCount(days);
    await expect(page.locator(".trip-timeline > li")).toHaveCount(5);
    await expect(page.getByRole("region", { name: "当日完整安排" })).toContainText(
      "早餐",
    );
    await expect(page.getByRole("region", { name: "当日完整安排" })).toContainText(
      "午餐",
    );
    await expect(page.getByRole("region", { name: "当日完整安排" })).toContainText(
      "晚餐",
    );
    await expect(page.getByRole("region", { name: "预算目标分配" })).toContainText(
      "不是实际报价",
    );
    await expect(page.getByRole("region", { name: "预算目标分配" })).toContainText(
      "实际支出未知",
    );
    const place = page.getByRole("button", { name: "测试文化场馆1", exact: true });
    await place.click();
    await expect(place).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "查看地图", exact: true }).click();
    await expect(page.getByRole("region", { name: "当天真实地图" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "地图暂不可用", exact: true }),
    ).toBeVisible();
    if (testInfo.project.name === "mobile") {
      const map = await page.getByRole("region", { name: "当天真实地图" }).boundingBox();
      expect(map!.height).toBeGreaterThanOrEqual(300);
      expect(map!.y).toBeGreaterThanOrEqual(0);
      expect(map!.y + map!.height).toBeLessThanOrEqual(
        testInfo.project.use.viewport!.height,
      );
      if (days === 1) {
        await page.screenshot({ path: "test-results/mobile-full-map-viewport.png" });
      }
      await page.getByRole("button", { name: "查看当天安排", exact: true }).click();
      await expect(place).toBeVisible();
    }
    if (days === 14) {
      await page.getByRole("tab", { name: /第 14 天/ }).click();
      await expect(page.getByRole("tab", { name: /第 14 天/ })).toBeInViewport();
      await expect(page.getByRole("region", { name: "当日完整安排" })).toContainText(
        "2027-01-13",
      );
      await expect(
        page.getByRole("button", { name: "测试文化场馆27", exact: true }),
      ).toBeVisible();
    }
    await geometry(page);
    await page.evaluate(() => document.fonts.ready.then(() => undefined));
    await expect(page.locator(".trip-daily-target")).toContainText(
      `第 ${days} 天均分参考目标`,
    );
    await expect(page.getByRole("region", { name: "预算目标分配" })).toContainText(
      "非当日实际费用",
    );
    await heading.focus();
    await page.evaluate(() => window.scrollTo(0, 0));
    if (days === 14) {
      await expect(page.getByRole("tab", { name: /第 14 天/ })).toBeInViewport();
    }
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-full-proposal-${days}d-viewport.png`,
    });
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-full-proposal-${days}d.png`,
      fullPage: true,
    });
    expect(calls).toBe(1);
    expect(errors).toEqual([]);
  });
}

test("new generated plans require confirmation and allow cancellation and version-increasing undo", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/itineraries", (route) => {
    calls += 1;
    const plan = fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON()));
    plan.title = calls === 1 ? "原方案" : "新方案";
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "result", plan }),
    });
  });
  await page.goto("/plan");
  await fill(page);
  await generate(page);
  await expect(page.getByRole("heading", { name: "原方案", exact: true })).toBeFocused();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.getByRole("button", { name: "调整旅行需求" }).click();
  await page.getByLabel("同行人数").fill("3");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await generate(page);
  await expect(page.getByRole("region", { name: "新方案确认" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "新方案", exact: true })).toBeFocused();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.getByRole("button", { name: "保留原方案" }).click();
  await expect(page.getByRole("heading", { name: "原方案", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "调整旅行需求" }).click();
  await page.getByLabel("同行人数").fill("3");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await generate(page);
  await page.getByRole("button", { name: "确认使用新方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  await expect(page.locator(".trip-cover-facts")).toContainText("3 人");
  await page.getByRole("button", { name: "撤销上次修改" }).click();
  await expect(page.getByRole("heading", { name: "原方案", exact: true })).toBeFocused();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "3");
  await expect(page.locator(".trip-cover-facts")).toContainText("2 人");
  expect(calls).toBe(3);
});

test("stream failures and cancelled generation preserve the current plan and form inputs", async ({
  page,
}) => {
  let calls = 0;
  let release: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let finished: () => void = () => {};
  const fulfilled = new Promise<void>((resolve) => {
    finished = resolve;
  });
  await page.route("**/api/itineraries", async (route) => {
    calls += 1;
    if (calls === 2) {
      return route.fulfill({
        contentType: "application/x-ndjson",
        body: JSON.stringify({
          type: "error",
          code: "unavailable",
          message: "真实路线服务暂不可用，未使用虚构路线。",
        }),
      });
    }
    if (calls === 3) {
      await gate;
    }
    await route
      .fulfill({
        contentType: "application/x-ndjson",
        body: JSON.stringify({
          type: "result",
          plan: fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON())),
        }),
      })
      .catch(() => {});
    if (calls === 3) {
      finished();
    }
  });
  await page.goto("/plan");
  await fill(page);
  await generate(page);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.getByRole("button", { name: "调整旅行需求" }).click();
  await page.getByLabel("同行人数").fill("4");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await generate(page);
  await expect(page.getByRole("main").getByRole("alert")).toContainText("未使用虚构路线");
  await expect(page.getByLabel("同行人数")).toHaveValue("4");
  await generate(page);
  await expect(page.getByRole("button", { name: "取消生成" })).toBeVisible();
  await page.getByRole("button", { name: "取消生成" }).click();
  release();
  await fulfilled;
  await expect(page.getByRole("status")).toContainText("已取消");
  await expect(page.getByLabel("同行人数")).toHaveValue("4");
  await page.getByRole("button", { name: "返回当前方案" }).click();
  await expect(page.locator(".trip-cover-facts")).toContainText("2 人");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  expect(calls).toBe(3);
});

test("the actual planning API enforces same origin and exposes missing configuration as unavailable, never fixtures", async ({
  page,
}) => {
  await page.goto("/plan");
  const blocked = await page.request.post("/api/itineraries", {
    headers: { Origin: "https://example.invalid" },
    data: {},
  });
  expect(blocked.status()).toBe(400);
  expect(await blocked.json()).toEqual({
    code: "invalid_request",
    message: "请从本应用页面发起请求。",
  });
  expect(blocked.headers()["cache-control"]).toBe("no-store");
  await fill(page);
  const response = page.waitForResponse((value) =>
    value.url().endsWith("/api/itineraries"),
  );
  await generate(page);
  const unavailable = await response;
  expect(unavailable.status()).toBe(503);
  expect(unavailable.headers()["cache-control"]).toBe("no-store");
  await expect(page.getByRole("main").getByRole("alert")).toContainText(
    "AI 规划服务暂不可用",
  );
  await expect(page.getByRole("heading", { name: "规划旅行" })).toBeVisible();
  await expect(page.locator("body")).not.toContainText("OPENAI_API_KEY");
  await expect(page.locator("body")).not.toContainText("fixture-model");
});
