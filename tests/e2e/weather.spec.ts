import { test, expect, type Page } from "@playwright/test";
import { fixtureDraft } from "../fixtures/draft";
import { fixtureWeather } from "../fixtures/weather";
import { roundWeatherLocation } from "../../src/domain/weather";
import { weatherInputSchema } from "../../src/lib/weather-contracts";
import { addFixturePlaces } from "./fixtures";

const messages = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => {
  const errors: string[] = [];
  messages.set(page, errors);
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      errors.push("Hydration warning detected");
    }
  });
});
test.afterEach(({ page }) => expect(messages.get(page)).toEqual([]));
const panel = (page: Page) => page.getByRole("region", { name: "当天天气" });
async function openWorkspace(page: Page, draft = fixtureDraft()) {
  await page.route("**/api/plans", (route) => route.fulfill({ json: { draft } }));
  await page.goto("/");
  await addFixturePlaces(page);
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(panel(page)).toBeVisible();
}
async function queryWeather(page: Page) {
  await panel(page).getByRole("checkbox").check();
  await panel(page).getByRole("button", { name: "查询天气", exact: true }).click();
}

test("manual daily forecast displays sources and coarse rain risk without changing a locked itinerary", async ({
  page,
}, testInfo) => {
  let calls = 0;
  await page.route("**/api/weather", async (route) => {
    calls += 1;
    expect(route.request().method()).toBe("POST");
    expect(route.request().headers()["content-type"]).toBe("application/json");
    const input = weatherInputSchema.parse(route.request().postDataJSON());
    expect(input).toMatchObject({
      date: "2026-10-17",
      location: [120.1, 30.2],
      region: "CN-mainland",
    });
    await route.fulfill({ json: { report: fixtureWeather(input.date) } });
  });
  await openWorkspace(page);
  expect(calls).toBe(0);
  await expect(panel(page).getByRole("button", { name: "查询天气" })).toBeDisabled();
  await page.getByRole("button", { name: "锁定位置", exact: true }).first().click();
  const before = await page.locator(".timeline").innerText();
  await queryWeather(page);
  await expect(panel(page)).toContainText("测试天气 fixture，非实时预报");
  await expect(panel(page)).toContainText("0 °C / 20 °C");
  await expect(panel(page)).toContainText("降水概率：60%");
  await expect(panel(page)).toContainText("预报有降水信号");
  await expect(panel(page)).toContainText("天气现象未知");
  await expect(panel(page)).toContainText("供应商更新时间未知");
  await expect(panel(page)).toContainText("测试署名：仅用于离线交互，不代表平台许可。");
  expect(await page.locator(".timeline").innerText()).toBe(before);
  await expect(page.getByRole("button", { name: "位置已锁", exact: true })).toHaveCount(
    1,
  );
  expect(calls).toBe(1);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await panel(page).screenshot({
    path: `test-results/${testInfo.project.name}-weather-panel.png`,
    caret: "initial",
  });
  await page.unroute("**/api/weather");
  await page.route("**/api/weather", (route) =>
    route.fulfill({ status: 503, json: { message: "测试刷新失败。" } }),
  );
  await panel(page).getByRole("button", { name: "刷新天气" }).click();
  await expect(panel(page).getByRole("alert", { name: "天气查询失败" })).toContainText(
    "显示此前查询结果，未保证最新",
  );
  await expect(panel(page)).toContainText("测试降雨");
});

test("real no-credential weather handler stays unknown and does not substitute fixtures", async ({
  page,
}) => {
  await openWorkspace(page);
  const response = page.waitForResponse((result) =>
    result.url().endsWith("/api/weather"),
  );
  await queryWeather(page);
  const result = await response;
  expect(result.status()).toBe(503);
  expect(result.headers()["cache-control"]).toBe("no-store");
  expect(await result.json()).toMatchObject({ code: "weather_not_configured" });
  await expect(panel(page).getByRole("alert", { name: "天气查询失败" })).toContainText(
    "当前天气未知",
  );
  await expect(panel(page)).not.toContainText("测试降雨");
  await expect(panel(page)).not.toContainText("fixture");
});

test("partial coverage and missing dates remain unknown, changing day never shows cached prior forecasts", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/weather", async (route) => {
    calls += 1;
    const input = weatherInputSchema.parse(route.request().postDataJSON());
    const report = fixtureWeather(input.date);
    if (!report.day || !report.source) {
      throw new Error("Incomplete test fixture");
    }
    report.status = "unknown";
    report.reason = calls === 1 ? "partial_coverage" : "missing_date";
    report.source.location = roundWeatherLocation(input.location);
    if (calls === 1) {
      report.day.startsAt = `${input.date}T07:00:00+08:00`;
    } else {
      report.day = null;
    }
    await route.fulfill({ json: { report } });
  });
  await openWorkspace(page);
  await queryWeather(page);
  await expect(panel(page)).toContainText("预报未覆盖完整日期");
  await page.getByRole("button", { name: "第 2 天", exact: true }).click();
  await expect(panel(page)).toContainText("天气尚未查询");
  await expect(panel(page)).not.toContainText("测试降雨");
  await expect(panel(page).getByRole("checkbox")).not.toBeChecked();
  await queryWeather(page);
  await expect(panel(page)).toContainText("返回数据没有覆盖此日期");
  await page.getByRole("button", { name: "第 1 天", exact: true }).click();
  await expect(panel(page)).toContainText("天气尚未查询");
  expect(calls).toBe(2);
});

test("wrong-date and invalid response DTOs are rejected rather than displayed", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/weather", async (route) => {
    calls += 1;
    const report = fixtureWeather(calls === 1 ? "2026-10-18" : "2026-10-17");
    await route.fulfill({
      json: { report: calls === 1 ? report : { ...report, ownerId: "must-not-display" } },
    });
  });
  await openWorkspace(page);
  await queryWeather(page);
  await expect(panel(page).getByRole("alert")).toContainText("天气日期与当前行程不一致");
  await expect(panel(page)).not.toContainText("测试降雨");
  await panel(page).getByRole("button", { name: "查询天气", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("服务响应格式异常");
  await expect(panel(page)).not.toContainText("must-not-display");
  expect(calls).toBe(2);
});

test("wrong reference points and missing-date reports with unrelated day data cannot leak a forecast", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/weather", async (route) => {
    calls += 1;
    const report = fixtureWeather(calls === 1 ? "2026-10-17" : "2026-10-18");
    if (!report.source) {
      throw new Error("Missing authored source");
    }
    if (calls === 1) {
      report.source.location = [120.14, 30.25];
    } else {
      report.date = "2026-10-17";
      report.status = "unknown";
      report.reason = "missing_date";
    }
    await route.fulfill({ json: { report } });
  });
  await openWorkspace(page);
  await queryWeather(page);
  await expect(panel(page).getByRole("alert")).toContainText("天气参考位置与查询不一致");
  await expect(panel(page)).not.toContainText("测试降雨");
  await panel(page).getByRole("button", { name: "查询天气", exact: true }).click();
  await expect(panel(page).getByRole("alert")).toContainText("服务响应格式异常");
  await expect(panel(page)).not.toContainText("测试降雨");
  expect(calls).toBe(2);
});

test("changing day aborts an in-flight query and ignores a late prior-day result", async ({
  page,
}) => {
  let release = () => {};
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route("**/api/weather", async (route) => {
    await pending;
    await route.fulfill({ json: { report: fixtureWeather() } });
  });
  await openWorkspace(page);
  await queryWeather(page);
  await expect(panel(page)).toContainText("正在查询天气");
  const cancelled = page.waitForEvent("requestfailed", {
    predicate: (request) => request.url().endsWith("/api/weather"),
  });
  await page.getByRole("button", { name: "第 2 天", exact: true }).click();
  await cancelled;
  release();
  await expect(panel(page)).toContainText("2026-10-18");
  await expect(panel(page)).toContainText("天气尚未查询");
  await expect(panel(page)).not.toContainText("测试降雨");
});

test("out-of-range date is handled by the real route before provider configuration", async ({
  page,
}) => {
  const draft = fixtureDraft();
  draft.input.startDate = "2099-10-17";
  draft.days[0].date = "2099-10-17";
  draft.days[1].date = "2099-10-18";
  await openWorkspace(page, draft);
  const response = page.waitForResponse((result) =>
    result.url().endsWith("/api/weather"),
  );
  await queryWeather(page);
  expect((await response).status()).toBe(200);
  await expect(panel(page)).toContainText("日期超出每日预报查询范围，天气未知");
  await expect(panel(page)).not.toContainText("测试天气 fixture");
});

test("weather route rejects cross-origin, malformed and wrong-coordinate-system requests", async ({
  request,
  baseURL,
}) => {
  const body = {
    date: "2099-10-17",
    location: [120.1, 30.2],
    coordinateSystem: "GCJ-02",
    region: "CN-mainland",
  };
  const crossOrigin = await request.post("/api/weather", {
    data: body,
    headers: { Origin: "https://attacker.invalid" },
  });
  expect(crossOrigin.status()).toBe(400);
  expect(await crossOrigin.json()).toMatchObject({ code: "invalid_request" });
  const invalid = await request.post("/api/weather", {
    data: { ...body, coordinateSystem: "WGS-84" },
    headers: { Origin: baseURL! },
  });
  expect(invalid.status()).toBe(400);
  expect(await invalid.json()).toMatchObject({ code: "invalid_input" });
  const malformed = await request.post("/api/weather", {
    data: "not JSON",
    headers: { Origin: baseURL!, "Content-Type": "application/json" },
  });
  expect(malformed.status()).toBe(400);
});
