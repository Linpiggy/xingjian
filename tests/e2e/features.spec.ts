import { expect, test } from "@playwright/test";
import { settleAt } from "./helpers";

/** 1×1 PNG，用于模拟上传照片 */
const PIXEL = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

async function openSample(page: import("@playwright/test").Page) {
  await settleAt(page, "/", "#samples");
  await page.getByRole("button", { name: /两天，古寺/ }).click();
  await expect(page.locator("#overview")).toBeVisible();
}

test.describe("问答、分享与拍照识景", () => {
  test("行前问答：流式回答、工具步骤与来源", async ({ page }) => {
    let question = "";
    await page.route("**/api/ask", async (route) => {
      question = (route.request().postDataJSON() as { question: string }).question;
      const events = [
        {
          type: "tool_call",
          id: "a",
          name: "search_knowledge",
          label: "检索知识库：灵隐寺 预约",
        },
        { type: "tool_result", id: "a", ok: true, summary: "命中 1 条" },
        { type: "answer", delta: "- 需要先买飞来峰门票\n" },
        { type: "answer", delta: "- 建议出行前在官方渠道核实" },
        {
          type: "sources",
          items: [{ id: "hz-lingyin", title: "灵隐寺与飞来峰游览要点" }],
          live: true,
        },
        { type: "done" },
      ];
      await route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
        body: events.map((event) => JSON.stringify(event)).join("\n"),
      });
    });
    await openSample(page);
    await page.getByRole("tab", { name: /问问 AI/ }).click();
    await page.locator("#ask-input").fill("灵隐寺要预约吗？");
    await page.getByRole("button", { name: "发送问题" }).click();
    await expect(page.getByText("需要先买飞来峰门票")).toBeVisible();
    await expect(page.getByText("高德实时数据")).toBeVisible();
    await expect(page.getByText("灵隐寺与飞来峰游览要点").last()).toBeVisible();
    expect(question).toBe("灵隐寺要预约吗？");

    // 问答记录随行程保存，刷新后仍在
    await page.reload();
    await page.getByRole("tab", { name: /问问 AI/ }).click();
    await expect(page.getByText("需要先买飞来峰门票")).toBeVisible();
  });

  test("分享：生成链接与长图，打开链接可只读查看并存为自己的行程", async ({
    page,
    context,
  }) => {
    await openSample(page);
    await page.getByRole("button", { name: "分享" }).click();
    const dialog = page.getByRole("dialog", { name: "分享这份手册" });
    await expect(dialog.getByRole("link", { name: "下载长图" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(dialog.getByRole("img", { name: /行程长图预览/ })).toBeVisible();
    const link = await dialog.getByLabel("分享链接").inputValue();
    expect(link).toContain("/share#1.");

    const viewer = await context.newPage();
    await viewer.goto(link);
    await expect(viewer.getByText("这是朋友分享给你的旅行手册")).toBeVisible();
    await expect(viewer.locator("#day-1")).toBeVisible();
    await viewer.getByRole("button", { name: "存到我的行程" }).click();
    await viewer.waitForURL(/\/plan\//);
    await expect(viewer.locator("#overview")).toBeVisible();
    await expect(viewer.getByText("这是一份示例手册")).toHaveCount(0);
  });

  test("损坏的分享链接给出明确提示", async ({ page }) => {
    await page.goto("/share#1.broken");
    await expect(page.getByRole("main").getByRole("alert")).toContainText("分享链接无效");
  });

  test("拍照识景：识别结果一键填入需求", async ({ page }) => {
    await page.route("**/api/vision", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          insight: {
            scene: "湖面与远山，傍晚",
            place: "西湖",
            city: "杭州",
            confidence: "high",
            styles: ["山水", "日落"],
            interests: ["自然风光", "摄影出片"],
            suggestions: [{ city: "苏州", reason: "同样有水乡园林" }],
            note: "想看一次湖边日落",
          },
        }),
      }),
    );
    await settleAt(page, "/", "#planner");
    await page
      .getByLabel("上传旅行照片")
      .setInputFiles({ name: "lake.png", mimeType: "image/png", buffer: PIXEL });
    await expect(page.getByText("看起来是")).toBeVisible();
    await page.getByRole("button", { name: /去杭州/ }).click();
    await expect(page.locator("#field-city")).toHaveValue("杭州");
    await expect(page.locator("#field-notes")).toHaveValue(/想看一次湖边日落/);
    await expect(page.getByRole("button", { name: "摄影出片" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("拍照识景未开启时提示清楚", async ({ page }) => {
    await settleAt(page, "/", "#planner");
    await page
      .getByLabel("上传旅行照片")
      .setInputFiles({ name: "lake.png", mimeType: "image/png", buffer: PIXEL });
    await expect(page.getByRole("main").getByRole("alert")).toContainText(
      "照片识别服务暂未开启",
    );
  });
});
