import { test, expect } from "@playwright/test";
import { fixtureItinerary } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

for (const limited of [false, true]) {
  test(`${limited ? "rate limit cooldown" : "model format failure"} preserves the brief and requires an explicit manual retry`, async ({
    page,
  }, testInfo) => {
    if (limited) {
      await page.clock.install();
    }
    let calls = 0;
    await page.route("**/api/itineraries", (route) => {
      calls += 1;
      if (calls === 1) {
        return route.fulfill({
          contentType: "application/x-ndjson",
          body:
            JSON.stringify({
              type: "error",
              stage: "model",
              code: limited ? "ai_rate_limited" : "ai_invalid_json",
              message: limited
                ? "模型服务暂时限流，请稍后重试。"
                : "AI 返回的 JSON 格式无效，未应用方案。",
              ...(limited ? { retryAfterSeconds: 2 } : {}),
            }) + "\n",
        });
      }
      return route.fulfill({
        contentType: "application/x-ndjson",
        body:
          JSON.stringify({
            type: "result",
            plan: fixtureItinerary(tripBriefSchema.parse(route.request().postDataJSON())),
          }) + "\n",
      });
    });
    await page.goto("/");
    await page.getByLabel("目的地城市").fill("测试城市");
    await page.getByLabel("旅行天数").fill("1");
    await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
    const generate = page.getByRole("button", { name: "生成我的完整方案" });
    await generate.click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      limited ? "限流" : "JSON 格式无效",
    );
    await expect(page.getByLabel("目的地城市")).toHaveValue("测试城市");
    await page.getByText("查看错误原因", { exact: true }).click();
    await expect(page.locator(".trip-failure-details")).toContainText("AI 规划");
    await expect(page.locator(".trip-failure-details")).toContainText(
      limited ? "ai_rate_limited" : "ai_invalid_json",
    );
    await expect(page.getByRole("button", { name: "取消生成" })).toHaveCount(0);
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "0");
    if (limited) {
      await expect(generate).toBeDisabled();
      await expect(page.getByRole("status")).toContainText("不会自动发送请求");
      await page.clock.runFor(2100);
    }
    await expect(generate).toBeEnabled();
    expect(calls).toBe(1);
    await page.screenshot({
      path: `test-results/${testInfo.project.name}-${limited ? "ai-cooldown" : "ai-format-failure"}.png`,
      fullPage: true,
    });
    await generate.click();
    await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
    expect(calls).toBe(2);
  });
}
