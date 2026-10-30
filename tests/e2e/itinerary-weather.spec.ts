import { test, expect } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { fixtureWeather } from "../fixtures/weather";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";
import { weatherInputSchema } from "../../src/lib/weather-contracts";
import { roundWeatherLocation } from "../../src/domain/weather";

test("full fourteen-day workspace queries weather explicitly, preserves locks and does not reuse an earlier forecast", async ({
  page,
}, testInfo) => {
  let weatherCalls = 0;
  await page.route("**/api/itineraries", (route) =>
    route.fulfill({
      contentType: "application/x-ndjson",
      body: JSON.stringify({
        type: "result",
        plan: fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON())),
      }),
    }),
  );
  await page.route("**/api/weather", (route) => {
    weatherCalls += 1;
    const input = weatherInputSchema.parse(route.request().postDataJSON());
    if (weatherCalls > 1) {
      return route.fallback();
    }
    const report = fixtureWeather(input.date);
    report.source!.location = roundWeatherLocation(input.location);
    return route.fulfill({ json: { report } });
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("14");
  await page.getByLabel("同行人数").fill("20");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await page.getByRole("button", { name: "查看测试早餐店的资料", exact: true }).click();
  await page.getByRole("button", { name: "预览锁定开始时间" }).click();
  await page.getByRole("button", { name: "确认此项修改" }).click();
  await expect(page.locator(".trip-time-lock")).toContainText("09:00");
  await page.getByText("当天天气与出行提示", { exact: true }).click();
  const panel = page.getByRole("region", { name: "当天天气", exact: true });
  await expect(panel).toContainText("天气尚未查询");
  await expect(
    panel.getByRole("button", { name: "查询天气", exact: true }),
  ).toBeDisabled();
  expect(weatherCalls).toBe(0);
  await panel.getByRole("checkbox", { name: /确认参考地点/ }).check();
  await panel.getByRole("button", { name: "查询天气", exact: true }).click();
  await expect(panel).toContainText("测试降雨");
  await expect(panel).toContainText("测试天气 fixture，非实时预报");
  await expect(panel).toContainText("测试署名");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  await expect(page.locator(".trip-time-lock")).toContainText("09:00");
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-full-weather-panel.png`,
    animations: "disabled",
  });
  await page.getByRole("tab", { name: /第 14 天/ }).click();
  await expect(panel).not.toContainText("测试降雨");
  await expect(panel).not.toContainText("测试署名");
  await expect(
    panel.getByRole("button", { name: "查询天气", exact: true }),
  ).toBeDisabled();
  expect(weatherCalls).toBe(1);
  await panel.getByRole("checkbox", { name: /确认参考地点/ }).check();
  const response = page.waitForResponse((value) => value.url().endsWith("/api/weather"));
  await panel.getByRole("button", { name: "查询天气", exact: true }).click();
  const actual = await response;
  expect(actual.status()).toBe(200);
  expect(actual.headers()["cache-control"]).toBe("no-store");
  expect((await actual.json()).report.reason).toBe("out_of_range");
  await expect(panel).toContainText("日期超出每日预报查询范围，天气未知");
  await expect(panel).not.toContainText("测试降雨");
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "2");
  expect(weatherCalls).toBe(2);
});
