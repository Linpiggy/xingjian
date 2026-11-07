import { expect, test } from "@playwright/test";
import { planEvents, reviseEvents, toNdjson } from "../fixtures/trip";

test.describe("规划主流程（fixture 回放）", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/agent", async (route) => {
      const body = route.request().postDataJSON() as {
        mode: string;
        instruction?: string;
      };
      const events = body.mode === "plan" ? planEvents() : reviseEvents();
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
        body: toNdjson(events),
      });
    });
  });

  test("表单校验后生成手册，可调整并撤销", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "生成旅行手册" }).click();
    await expect(page.getByText("请填写目的地")).toBeVisible();
    await expect(page.locator("#field-city")).toBeFocused();

    await page.getByRole("button", { name: "杭州" }).first().click();
    await page.getByRole("button", { name: "减少天数" }).click();
    await page.getByRole("button", { name: "生成旅行手册" }).click();
    await page.waitForURL(/\/plan\//);

    await expect(page.getByRole("heading", { name: "测试两日·湖与城" })).toBeVisible();
    await expect(page.locator("#day-1")).toContainText("湖畔漫步");
    await expect(page.locator("#day-2")).toContainText("片儿川");
    await expect(page.getByText("闭园前仅剩 30 分钟").first()).toBeVisible();
    await expect(page.getByText("2 处景点门票未知", { exact: false })).toBeVisible();
    // 无地图 Key 时显示示意图并明确标注
    await page.locator("#day-1").scrollIntoViewIfNeeded();
    await expect(page.locator("#day-1").getByText("路线示意 · 未加载底图")).toBeVisible();
    // 悬浮按钮打开全屏地图，列表与地图联动，“看详情”回到手册
    await page.getByRole("button", { name: /全屏地图/ }).click();
    const overlay = page.getByRole("dialog", { name: /路线地图/ });
    await expect(overlay).toBeVisible();
    await overlay
      .locator("ol")
      .getByRole("button", { name: /测试博物馆/ })
      .click();
    await overlay.getByRole("button", { name: "看详情" }).click();
    await expect(overlay).toBeHidden();
    // 知识库引用可跳转到来源
    await expect(page.locator("#cite-hz-overview")).toContainText(
      "杭州：西湖片区怎么分区游",
    );

    await page.locator("#revise-input").fill("第二天换一个博物馆");
    await page.getByRole("button", { name: "发送调整要求" }).click();
    await expect(page.getByText("已调整：")).toBeVisible();
    await expect(page.locator("#day-2")).toContainText("调整后的博物馆");

    await page.getByRole("button", { name: "撤销" }).click();
    await expect(page.locator("#day-2")).not.toContainText("调整后的博物馆");

    // 刷新后从本地存储恢复
    await page.reload();
    await expect(page.getByRole("heading", { name: "测试两日·湖与城" })).toBeVisible();
    await page.goto("/trips");
    await expect(page.getByText("测试两日·湖与城")).toBeVisible();
  });

  test("服务端错误时可见并可重试", async ({ page }) => {
    await page.unroute("**/api/agent");
    await page.route("**/api/agent", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({
          code: "not_configured",
          message: "服务端未配置大模型密钥",
        }),
      }),
    );
    await page.goto("/?city=杭州");
    await page.getByRole("button", { name: "生成旅行手册" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "服务端未配置大模型密钥",
    );
    await expect(page.getByRole("button", { name: "重新生成" })).toBeVisible();
  });
});
