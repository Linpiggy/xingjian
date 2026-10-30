import { test, expect, type Page } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

async function generate(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (
      message.type() === "error" &&
      /hydration|hydrated|server rendered|didn't match/i.test(message.text())
    ) {
      errors.push(message.text());
    }
  });
  let routeCalls = 0;
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
  await expect(page.getByLabel("旅行天数", { exact: true })).toHaveAccessibleDescription(
    "1—14 天，同一城市",
  );
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("14");
  await page.getByLabel("同行人数").fill("20");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案", exact: true }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  return () => {
    expect(errors).toEqual([]);
    expect(routeCalls).toBe(0);
  };
}

test("Arc dates use manual keyboard activation, linked panels and overflow controls without remounting the map", async ({
  page,
}, testInfo) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  const verify = await generate(page);
  const originalMap = await page
    .locator(".route-map")
    .evaluateHandle((element) => element);
  const dates = page.getByRole("tablist", { name: "选择当天路线与安排" });
  const first = dates.getByRole("tab").first();
  const last = dates.getByRole("tab").last();
  await expect(dates.getByRole("tab")).toHaveCount(14);
  await first.focus();
  await page.keyboard.press("End");
  await expect(last).toBeFocused();
  await expect(last).toHaveAttribute("aria-selected", "false");
  await expect(first).toHaveAttribute("aria-selected", "true");
  await page.keyboard.press("Enter");
  await expect(last).toHaveAttribute("aria-selected", "true");
  const panel = page.getByRole("tabpanel", { name: /第 14 天/ });
  await expect(panel).toHaveAttribute("id", (await last.getAttribute("aria-controls"))!);
  await expect(panel).toHaveAccessibleName(/第 14 天/);
  await expect(
    panel.getByRole("heading", { name: "第 14 天路线", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "下一天", exact: true })).toBeDisabled();
  await page.keyboard.press("Home");
  await expect(first).toBeFocused();
  await page.keyboard.press("Space");
  await expect(first).toHaveAttribute("aria-selected", "true");
  expect(
    await page
      .locator(".route-map")
      .evaluate((element, original) => element === original, originalMap),
  ).toBe(true);
  await originalMap.dispose();
  for (const width of testInfo.project.name === "desktop" ? [960, 620] : [390, 360]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(first).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth && window.scrollX === 0,
      ),
    ).toBe(true);
    const nextDates = page.getByRole("button", { name: "查看后面的日期", exact: true });
    await expect(nextDates).toBeVisible();
    expect((await nextDates.boundingBox())!.width).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-arc-dates.png`,
    animations: "disabled",
  });
  verify();
});

test("Arc disclosures remain independent, expose hidden state and preserve native dialog return focus", async ({
  page,
}, testInfo) => {
  const verify = await generate(page);
  const experiences = page.locator(".trip-experience");
  const trigger = experiences
    .first()
    .getByRole("button", { name: "体验建议", exact: true });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.focus();
  await page.keyboard.press("Enter");
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(experiences.first().getByRole("region")).toBeVisible();
  await expect(experiences.nth(1).getByRole("button")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.keyboard.press("Space");
  await expect(experiences.first().getByRole("region")).toHaveCount(0);
  const detail = page.getByRole("button", {
    name: "查看测试文化场馆1的资料",
    exact: true,
  });
  await detail.click();
  const dialog = page.getByRole("dialog", { name: "测试文化场馆1", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("建议停留（分钟）")).toHaveValue("60");
  await dialog.getByLabel("建议停留（分钟）").focus();
  await expect(dialog.getByLabel("建议停留（分钟）")).toBeInViewport();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-arc-details.png`,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(detail).toBeFocused();
  await expect
    .poll(() => page.evaluate(() => document.body.style.overflow))
    .not.toBe("hidden");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  verify();
});

test("pointer date animation never covers another date label and settles on the selected day", async ({
  page,
}, testInfo) => {
  await page.clock.install();
  const verify = await generate(page);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const dates = page.getByRole("tablist", { name: "选择当天路线与安排" });
  const last = dates.getByRole("tab").last();
  await last.click();
  await expect(last).toHaveAttribute("aria-selected", "true");
  // Arc isolates the list, not each trigger: the moving negative-z indicator
  // must stay below every label, including labels in preceding triggers.
  expect(await dates.evaluate((element) => getComputedStyle(element).isolation)).toBe(
    "isolate",
  );
  expect(await last.evaluate((element) => getComputedStyle(element).isolation)).toBe(
    "auto",
  );
  const frames: { frame: number; covered: string[] }[] = [];
  for (const milliseconds of [16, 48, 96, 144, 240, 480]) {
    await page.clock.runFor(milliseconds);
    const covered = await dates.evaluate((list) => {
      const viewport = list.parentElement;
      if (!viewport) {
        throw new Error("Missing date viewport");
      }
      const view = viewport.getBoundingClientRect();
      return Array.from(list.querySelectorAll<HTMLElement>('[role="tab"]'))
        .filter((tab) => {
          const rect = tab.getBoundingClientRect();
          if (rect.left < view.left + 4 || rect.right > view.right - 4) {
            return false;
          }
          return (
            document
              .elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
              ?.closest('[role="tab"]') !== tab
          );
        })
        .map((tab) => tab.textContent ?? "");
    });
    frames.push({ frame: milliseconds, covered });
    if (milliseconds === 96) {
      await page.screenshot({
        path: `test-results/${testInfo.project.name}-arc-date-motion.png`,
      });
    }
  }
  expect(frames).toEqual(frames.map(({ frame }) => ({ frame, covered: [] })));
  const selection = last.locator(':scope > span[aria-hidden="true"]');
  await expect
    .poll(() => selection.evaluate((element) => getComputedStyle(element).transform))
    .toMatch(/^(none|matrix\(1, 0, 0, 1, 0, 0\))$/);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-arc-date-settled.png`,
  });
  verify();
});
