import type { Page } from "@playwright/test";

/**
 * 首页很长且中文字体按需分片加载：先滚到目标区域，等网络与字体稳定后再操作，
 * 避免字体替换引起的重排让点击落到其他元素上。
 */
export async function settleAt(page: Page, path: string, selector: string) {
  await page.goto(path);
  await page
    .locator(selector)
    .evaluate((node) => node.scrollIntoView({ block: "start" }));
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
}
