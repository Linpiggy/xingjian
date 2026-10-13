import { test, expect } from "@playwright/test";
import { fixtureDraft, input } from "../fixtures/draft";

test("actual HTTP route accepts loopback origin without calling a provider", async ({
  request,
}) => {
  const response = await request.post("/api/plans", {
    headers: { Origin: "http://127.0.0.1:3100" },
    data: input,
  });
  expect(response.status()).toBe(503);
  expect((await response.json()).code).toBe("not_configured");
});

test("form validation, successful draft, selection and missing map config", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      errors.push("Hydration warning detected");
    }
  });
  await page.route("**/api/plans", (route) =>
    route.fulfill({ json: { draft: fixtureDraft() } }),
  );
  await page.goto("/");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-form-light.png`,
    fullPage: true,
    caret: "initial",
  });
  await page.getByLabel("目的地城市").fill("");
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByText("请输入目的地城市", { exact: true })).toBeVisible();
  await expect(page.getByLabel("目的地城市")).toBeFocused();
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("heading", { name: "测试城市2日路线草稿" })).toBeVisible();
  await expect(
    page.getByText("测试 fixture：此页面数据不是真实接口查询。"),
  ).toBeVisible();
  await expect(page.getByText("约 20 分钟 / 1.2 km", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /测试景点二/ }).click();
  if (testInfo.project.name === "mobile") {
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(
      page.getByRole("dialog").getByRole("heading", { name: "测试景点二" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).not.toBeVisible();
    await page.getByRole("button", { name: "地图", exact: true }).click();
  } else {
    await expect(
      page
        .getByRole("complementary", { name: "地点详情" })
        .getByRole("heading", { name: "测试景点二" }),
    ).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "真实地图未配置" })).toBeVisible();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-light.png`,
    fullPage: true,
  });
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await expect(page.locator("body")).toHaveCSS("background-color", "rgb(17, 36, 31)");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-dark.png`,
    fullPage: true,
  });
  expect(errors).toEqual([]);
});

test("provider error preserves inputs and permits retry", async ({ page }) => {
  let tries = 0;
  await page.route("**/api/plans", (route) => {
    tries++;
    return route.fulfill(
      tries === 1
        ? { status: 503, json: { code: "unavailable", message: "测试服务暂时不可用。" } }
        : { json: { draft: fixtureDraft() } },
    );
  });
  await page.goto("/");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("alert", { name: "行程查询失败" })).toContainText(
    "输入已保留",
  );
  await expect(page.getByLabel("目的地城市")).toHaveValue("测试城市");
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("heading", { name: "测试城市2日路线草稿" })).toBeVisible();
  expect(tries).toBe(2);
});

test("empty budget is rejected and decimal budget sends integer fen", async ({
  page,
}) => {
  let calls = 0;
  await page.route("**/api/plans", (route) => {
    calls++;
    expect(route.request().postDataJSON().budgetPerPersonFen).toBe(110);
    const draft = fixtureDraft();
    draft.input.budgetPerPersonFen = 110;
    return route.fulfill({ json: { draft } });
  });
  await page.goto("/");
  await page.getByLabel("每人预算（元）").fill("");
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByText("请填写每人预算", { exact: true })).toBeVisible();
  expect(calls).toBe(0);
  await page.getByLabel("每人预算（元）").fill("1.10");
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await expect(page.getByRole("heading", { name: "测试城市2日路线草稿" })).toBeVisible();
  expect(calls).toBe(1);
});

test("switching days and confirming new draft reset", async ({ page }) => {
  await page.route("**/api/plans", (route) =>
    route.fulfill({ json: { draft: fixtureDraft() } }),
  );
  await page.goto("/");
  await page.getByRole("button", { name: "生成路线草稿" }).click();
  await page.getByRole("button", { name: "第 2 天", exact: true }).click();
  await expect(page.getByRole("button", { name: /测试景点三/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /测试景点一/ })).not.toBeVisible();
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "新建计划", exact: true }).click();
  await expect(page.getByRole("button", { name: "生成路线草稿" })).toBeVisible();
});
