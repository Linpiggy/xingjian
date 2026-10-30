import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

const widths = [360, 390, 960, 1440];
async function generate(page: Page) {
  const errors: string[] = [];
  let routeCalls = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/routes", (route) => {
    routeCalls += 1;
    return route.abort();
  });
  await page.route("**/api/itineraries", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        type: "result",
        plan: fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON())),
      }),
    }),
  );
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("14");
  await page.getByLabel("同行人数").fill("20");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案", exact: true }).click();
  await expect(page.locator(".unified-planner")).toHaveAttribute(
    "data-plan-revision",
    "1",
  );
  return () => {
    expect(errors).toEqual([]);
    expect(routeCalls).toBe(0);
  };
}
async function documentFlow(page: Page) {
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth && window.scrollX === 0,
    ),
  ).toBe(true);
  const scrollAreas = await page.locator(".trip-app").evaluate((root) =>
    Array.from(root.querySelectorAll<HTMLElement>("*"))
      .filter((element) => {
        if (
          element.closest("dialog") ||
          element.matches("input, textarea, select") ||
          element.getBoundingClientRect().height === 0
        ) {
          return false;
        }
        return (
          /auto|scroll/u.test(getComputedStyle(element).overflowY) &&
          element.scrollHeight > element.clientHeight + 1
        );
      })
      .map((element) => element.className),
  );
  expect(scrollAreas).toEqual([]);
  const map = (await page
    .getByRole("complementary", { name: "当天路线地图", exact: true })
    .boundingBox())!;
  const day = (await page
    .getByRole("region", { name: "当日完整安排", exact: true })
    .boundingBox())!;
  expect(map.y + map.height).toBeLessThanOrEqual(day.y);
  expect(Math.abs(map.width - day.width)).toBeLessThan(2);
}

test("current date stays fully visible without a mask at all four design widths", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const verify = await generate(page);
  const last = page.getByRole("tab", { name: /第 14 天/ });
  await last.click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(last).toHaveAttribute("aria-selected", "true");
    await expect
      .poll(() =>
        last.evaluate((tab) => {
          const viewport = tab.closest('[role="tablist"]')?.parentElement;
          if (!viewport) {
            return false;
          }
          const frame = viewport.getBoundingClientRect();
          const item = tab.getBoundingClientRect();
          const style = getComputedStyle(viewport);
          return (
            style.maskImage === "none" &&
            item.left >= frame.left + parseFloat(style.paddingLeft) - 1 &&
            item.right <= frame.right - parseFloat(style.paddingRight) + 1
          );
        }),
      )
      .toBe(true);
    await documentFlow(page);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-design-date-${width}.png`,
      animations: "disabled",
    });
  }
  verify();
});

test("manual compatibility URLs share one workspace and keep both modes without making requests", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/**", (route) => {
    calls += 1;
    return route.abort();
  });
  await page.goto("/manual");
  await expect(page).toHaveURL(/\/plan\?mode=manual$/);
  await expect(page.locator(".trip-site-header")).toHaveCount(1);
  await expect(page.getByRole("main")).toHaveCount(1);
  const manual = page.locator("#planning-panel-manual");
  await manual.getByLabel("目的地城市").fill("保留手动城市");
  await page.getByRole("link", { name: "规划工作台", exact: true }).click();
  await expect(page).toHaveURL(/\/plan$/);
  await expect(page.getByRole("tab", { name: /完整 AI 规划/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator("#planning-panel-ai").getByLabel("目的地城市").fill("保留 AI 城市");
  await page.getByRole("tab", { name: /手动选点/ }).click();
  await expect(page).toHaveURL(/\/plan\?mode=manual$/);
  await expect(manual.getByLabel("目的地城市")).toHaveValue("保留手动城市");
  await page.getByRole("tab", { name: /完整 AI 规划/ }).click();
  await expect(page.locator("#planning-panel-ai").getByLabel("目的地城市")).toHaveValue(
    "保留 AI 城市",
  );
  expect(calls).toBe(0);
});

test("fees have one editing entry and map pins do not duplicate the keyboard stop index at four widths", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const verify = await generate(page);
  await page.getByRole("tab", { name: /第 14 天/ }).click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("tablist", { name: "规划方式", exact: true }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "费用估算", exact: true })).toHaveCount(
      0,
    );
    await expect(page.locator("#itinerary-expenses-trigger")).toHaveCount(1);
    await page
      .getByRole("button", { name: "查看或补充手动费用估算", exact: true })
      .click();
    const edit = page.getByRole("button", { name: "编辑全程费用估算", exact: true });
    await expect(edit).toHaveCount(1);
    await edit.click();
    await expect(
      page.getByRole("dialog", { name: "补齐全程费用参考", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(edit).toBeFocused();
    await page
      .getByRole("button", { name: "查看或补充手动费用估算", exact: true })
      .click();
    const index = page.getByRole("navigation", { name: "地图地点索引", exact: true });
    const buttons = index.getByRole("button");
    await expect(buttons).toHaveCount(5);
    await buttons.first().focus();
    for (let i = 0; i < 5; i += 1) {
      await expect(buttons.nth(i)).toBeFocused();
      if (i < 4) {
        await page.keyboard.press("Tab");
      }
    }
    await page.keyboard.press("Enter");
    await expect(buttons.last()).toHaveAttribute("aria-pressed", "true");
    const markers = page.locator(".map-stage .map-marker");
    await expect(markers).toHaveCount(5);
    for (const marker of await markers.all()) {
      await expect(marker).toHaveAttribute("tabindex", "-1");
    }
    await expect(
      page
        .getByRole("region", { name: "当日行程速览", exact: true })
        .getByRole("button", { name: /^在地图中定位/ }),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "查看地图", exact: true }).click();
    await documentFlow(page);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-design-entry-${width}.png`,
      animations: "disabled",
    });
  }
  verify();
});

test("the timeline has one editing entry and a one-pixel track between time and station at all four widths", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const verify = await generate(page);
  await page.getByRole("tab", { name: /第 14 天/ }).click();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole("button", { name: "查看当天安排", exact: true }).click();
    const activities = page.locator(".trip-timeline article");
    await expect(activities).toHaveCount(5);
    for (const activity of await activities.all()) {
      await expect(activity.locator(".trip-place-evidence")).toHaveCount(1);
      await expect(activity.locator(".trip-place-evidence")).toHaveText("编辑");
      await expect(activity.locator(".trip-place-select")).toHaveCount(1);
      await expect(
        activity.getByRole("button", { name: "查看与编辑", exact: true }),
      ).toHaveCount(0);
      await expect(activity).toHaveCSS("border-radius", "0px");
      await expect(activity).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(activity).toHaveCSS("box-shadow", "none");
      expect(
        await activity.evaluate((element) => {
          const track = getComputedStyle(element, "::before");
          const lineX = element.getBoundingClientRect().left + parseFloat(track.left);
          const time = element.querySelector("time")!.getBoundingClientRect();
          const body = element
            .querySelector(".trip-activity-body")!
            .getBoundingClientRect();
          return track.width === "1px" && time.right <= lineX && lineX < body.left;
        }),
      ).toBe(true);
    }
    const trigger = page.getByRole("button", {
      name: "查看测试文化场馆27的资料",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "测试文化场馆27", exact: true });
    await expect(dialog.getByLabel("建议停留（分钟）")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await page.getByRole("button", { name: "查看当天安排", exact: true }).click();
    expect(
      await page
        .locator(".trip-day-heading")
        .evaluate(
          (element) =>
            element.getBoundingClientRect().top -
            document.querySelector(".trip-day-nav")!.getBoundingClientRect().bottom,
        ),
    ).toBeGreaterThanOrEqual(12);
    await documentFlow(page);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-design-timeline-${width}.png`,
      animations: "disabled",
    });
  }
  verify();
});

test("activity proposals land beside the edited activity without jumping to the cover or adding a scroll pane", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const verify = await generate(page);
  await page.getByRole("tab", { name: /第 14 天/ }).click();
  let version = 1;
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    const edit = page.getByRole("button", {
      name: "查看测试文化场馆27的资料",
      exact: true,
    });
    await edit.click();
    const dialog = page.getByRole("dialog", { name: "测试文化场馆27", exact: true });
    await dialog.getByLabel("建议停留（分钟）").fill("45");
    await dialog.getByRole("button", { name: "预览停留调整", exact: true }).click();
    const review = page.getByRole("region", { name: "新方案确认", exact: true });
    await expect(review).toBeVisible();
    await expect(page.locator("#trip-review-heading")).toBeFocused();
    await expect
      .poll(() =>
        review
          .getByRole("button", { name: "确认此项修改", exact: true })
          .evaluate((element) => {
            const rect = element.getBoundingClientRect();
            const navigation = document
              .querySelector(".trip-day-nav")
              ?.getBoundingClientRect();
            return rect.top >= (navigation?.bottom ?? 0) && rect.bottom <= innerHeight;
          }),
      )
      .toBe(true);
    expect(
      await review.evaluate((element) =>
        element
          .closest("li")
          ?.querySelector("article")
          ?.textContent?.includes("测试文化场馆27"),
      ),
    ).toBe(true);
    expect(
      await page
        .locator(".trip-cover h1")
        .evaluate((element) => element.getBoundingClientRect().bottom),
    ).toBeLessThan(0);
    await documentFlow(page);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-design-proposal-${width}.png`,
      animations: "disabled",
    });
    const before = await page.evaluate(() => scrollY);
    await review.getByRole("button", { name: "确认此项修改", exact: true }).click();
    await expect(page.locator(".unified-planner")).toHaveAttribute(
      "data-plan-revision",
      String(++version),
    );
    expect(Math.abs((await page.evaluate(() => scrollY)) - before)).toBeLessThan(24);
    await expect(page.getByRole("tab", { name: /第 14 天/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(edit).toBeFocused();
    await page.getByRole("button", { name: /撤销上次修改/ }).click();
    await expect(page.locator(".unified-planner")).toHaveAttribute(
      "data-plan-revision",
      String(++version),
    );
    await expect(edit).toBeFocused();
  }
  verify();
});
