import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";
import { routeReplay } from "../../src/features/map/route-replay";
import type { Day } from "../../src/domain/models";

async function setup(
  page: Page,
  mode: "normal" | "partial" | "empty" = "normal",
  screenshotName?: string,
) {
  let supplierCalls = 0;
  let reference: Day | null = null;
  await page.route("**/api/**", (route) => {
    supplierCalls += 1;
    return route.abort();
  });
  await page.route("**/api/itineraries", (route) => {
    const plan = fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON()));
    const schedule = plan.days[0].schedule!;
    for (const [index, leg] of schedule.legs.entries()) {
      const from = schedule.items[index].activity.place.location;
      const to = schedule.items[index + 1].activity.place.location;
      leg.route!.segments =
        mode === "empty" ? [] : [[from, [(from[0] + to[0]) / 2, from[1] + 0.002], to]];
      if (mode === "partial" && index === 1) {
        leg.route!.segments = [];
      }
      if (mode === "partial" && index === 0) {
        leg.route!.segments = [
          [from, [from[0] + 0.001, from[1] + 0.001]],
          [[to[0] + 0.002, to[1] + 0.002], to],
        ];
      }
    }
    reference = {
      date: plan.days[0].date,
      items: schedule.items.map((item) => ({
        activityId: item.activity.id,
        purpose: item.activity.kind,
        place: item.activity.place,
        stayMinutes: item.activity.stayMinutes,
        startMinute: item.startMinute,
        endMinute: item.endMinute,
      })),
      legs: schedule.legs.map((leg, index) => ({
        fromId: schedule.items[index].activity.place.id,
        toId: schedule.items[index + 1].activity.place.id,
        route: leg.route,
        error: null,
      })),
      issues: [],
    };
    return route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({ type: "result", plan }),
    });
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("14");
  await page.getByLabel("同行人数").fill("20");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  if (screenshotName) {
    await page.screenshot({
      path: `test-results/${screenshotName}-paper-workspace-brief.png`,
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.getByRole("button", { name: "生成我的完整方案", exact: true }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page
    .getByRole("complementary", { name: "当天路线地图", exact: true })
    .locator(".route-inline-inspection > summary")
    .click();
  return { calls: () => supplierCalls, day: () => reference! };
}

test("enlarged map preserves a single accessible preview, native dialog focus and Escape restoration without requests", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const source = await setup(page, "normal", testInfo.project.name);
  const preview = page.getByRole("region", { name: "当天真实地图", exact: true });
  const before = (await preview.boundingBox())!;
  await expect(
    page.getByRole("group", { name: "当天路线几何预览，无地图底图" }),
  ).toBeVisible();
  const expand = page.getByRole("button", { name: "放大地图", exact: true });
  await expand.click();
  const dialog = page.getByRole("dialog", { name: "全天路线" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByText("离线测试 fixture · 非真实查询路线", { exact: true }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("navigation", { name: "地图地点索引" }).getByRole("button"),
  ).toHaveCount(5);
  const after = (await dialog
    .getByRole("region", { name: "放大的当天地图" })
    .boundingBox())!;
  expect(after.width * after.height).toBeGreaterThan(before.width * before.height);
  expect(await page.evaluate(() => document.body.style.overflow)).toBe("hidden");
  const close = dialog.getByRole("button", { name: "收起放大地图", exact: true });
  const controls = dialog.locator(
    "button:not(:disabled), input:not(:disabled), select:not(:disabled)",
  );
  await close.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(controls.last()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(close).toBeFocused();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-paper-map-expanded.png`,
    animations: "disabled",
  });
  await page.setViewportSize({
    width: testInfo.project.name === "desktop" ? 960 : 360,
    height: 740,
  });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  const frame = (await dialog
    .getByRole("region", { name: "放大的当天地图" })
    .boundingBox())!;
  const markers = await dialog.locator(".route-diagram button").all();
  for (const marker of markers) {
    const box = (await marker.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(frame.x);
    expect(box.x + box.width).toBeLessThanOrEqual(frame.x + frame.width);
    expect(box.y).toBeGreaterThanOrEqual(frame.y);
    expect(box.y + box.height).toBeLessThanOrEqual(frame.y + frame.height);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(expand).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.body.style.overflow)).toBe("");
  await expect(preview).toBeVisible();
  await page.getByRole("button", { name: "演示路线", exact: true }).click();
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "暂停演示", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  expect(source.calls()).toBe(0);
});

test("replay follows authored fixture geometry, pauses, changes speed, seeks and resets on day changes without planning calls", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const source = await setup(page);
  await page.clock.install();
  const progress = page.getByRole("slider", { name: "路线演示进度" });
  await expect(progress).toHaveValue("0");
  await page.getByRole("button", { name: "播放全天路线", exact: true }).click();
  await expect(page.getByRole("button", { name: "暂停演示", exact: true })).toBeVisible();
  await page.clock.runFor(500);
  const initial = Number(await progress.inputValue());
  expect(initial).toBeGreaterThan(0);
  const cursor = page.locator(".route-diagram .route-replay-cursor");
  await expect(cursor).toHaveCount(1);
  const firstX = await cursor.getAttribute("cx");
  await page.clock.runFor(500);
  expect(await cursor.getAttribute("cx")).not.toBe(firstX);
  await page.getByRole("button", { name: "暂停演示", exact: true }).click();
  const paused = await progress.inputValue();
  await page.clock.runFor(500);
  await expect(progress).toHaveValue(paused);
  await page.getByLabel("路线演示速度", { exact: true }).selectOption("4");
  await progress.focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("button", { name: "重新播放", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "回到路线起点", exact: true }).click();
  await expect(progress).toHaveValue("0");
  await page.getByRole("button", { name: "播放全天路线", exact: true }).click();
  await page.clock.runFor(500);
  expect(Number(await progress.inputValue())).toBeGreaterThan(initial);
  await page.getByRole("button", { name: /第 14 天/ }).click();
  await expect(progress).toHaveValue("0");
  await expect(
    page.getByRole("button", { name: "播放全天路线", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  expect(source.calls()).toBe(0);
});

test("missing and disconnected geometry stays separate and the cursor disappears across its gap", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  const source = await setup(page, "partial");
  await expect(page.locator(".route-diagram polyline")).toHaveCount(4);
  await expect(page.getByText(/1 段缺少可演示轨迹/)).toBeVisible();
  const track = routeReplay(source.day());
  expect(track.parts[1].gapBefore).toBe(true);
  await page.clock.install();
  await page.getByRole("button", { name: "播放全天路线", exact: true }).click();
  await page.clock.runFor(track.parts[0].endMs + 350);
  await expect(page.locator(".route-diagram .route-replay-cursor")).toHaveCount(0);
  await expect(page.getByText(/此处轨迹断开/)).toBeVisible();
  await page.clock.runFor(500);
  await expect(page.locator(".route-diagram .route-replay-cursor")).toHaveCount(1);
  expect(source.calls()).toBe(0);
});

test("reduced motion retains manual route inspection and no geometry never creates an animation", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const source = await setup(page);
  await expect(
    page.getByRole("button", { name: "播放全天路线", exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/已启用减少动态效果，可用进度条/)).toBeVisible();
  await page.getByRole("button", { name: "查看后一段轨迹", exact: true }).click();
  expect(
    Number(await page.getByRole("slider", { name: "路线演示进度" }).inputValue()),
  ).toBeGreaterThan(0);
  await expect(page.locator(".trip-timeline > li")).toHaveCount(5);
  await expect(page.locator(".trip-timeline > li").first()).toBeVisible();
  const glance = page.getByRole("region", { name: "当日行程速览", exact: true });
  await expect(glance).toContainText("2 处游览");
  await expect(glance).toContainText("3 次用餐");
  await glance.getByText(/查看行程节奏/).click();
  await glance
    .getByRole("button", { name: "在地图中定位第 1 站：测试早餐店", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "选中地点：测试早餐店", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-paper-workspace-rich.png`,
    animations: "disabled",
  });
  expect(source.calls()).toBe(0);
  const empty = await setup(page, "empty");
  await expect(page.locator(".route-diagram polyline")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "播放全天路线", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByText("没有可演示的轨迹，不会用地点间直线代替路线。", { exact: true }),
  ).toBeVisible();
  expect(empty.calls()).toBe(0);
});
