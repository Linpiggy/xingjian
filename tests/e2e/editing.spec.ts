import { expect, test } from "@playwright/test";
import { fixtureTrip, planEvents, toNdjson } from "../fixtures/trip";
import { settleAt } from "./helpers";

test.describe("日期选择、示例手册与手动编辑", () => {
  test("日期弹层可用键盘选择，并显示行程范围", async ({ page }) => {
    await settleAt(page, "/", "#planner");
    const trigger = page.locator("#field-startDate");
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "选择出发日期" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("共 3 天");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    await page.locator("#field-arrivalTime").click();
    await page.getByRole("option", { name: /14:00/ }).click();
    await expect(page.locator("#field-arrivalTime")).toContainText("14:00");
  });

  test("示例手册可直接打开", async ({ page }) => {
    await settleAt(page, "/", "#samples");
    await page.getByRole("button", { name: /两天，灵隐听钟/ }).click();
    await page.waitForURL(/\/plan\//);
    await expect(page.getByText("这是一份示例手册")).toBeVisible();
    await expect(page.locator("#day-1")).toBeVisible();
    // 往返车次（高德跨城数据）与 12306 购票入口
    const trains = page.getByRole("region", { name: "往返车次" });
    await expect(trains).toContainText("G225");
    await expect(trains.getByRole("link", { name: /12306/ })).toHaveAttribute(
      "href",
      /12306\.cn/,
    );
    // 推荐菜标出高德招牌菜
    await expect(page.locator("#day-1").getByText("招牌").first()).toBeVisible();
  });

  test("锁定、换一个与重新排程", async ({ page }) => {
    await page.route("**/api/agent", (route) =>
      route.fulfill({
        status: 200,
        headers: { "Content-Type": "application/x-ndjson" },
        body: toNdjson(planEvents()),
      }),
    );
    let rescheduled: { day: number; stops: { place: { name: string } }[] } | null = null;
    await page.route("**/api/reschedule", async (route) => {
      rescheduled = route.request().postDataJSON();
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          trip: fixtureTrip("第 1 天：「测试面馆」换成了「测试备选餐厅」"),
        }),
      });
    });

    await settleAt(page, "/?city=杭州", "#planner");
    await page.getByRole("button", { name: "生成旅行手册" }).click();
    await expect(page.locator("#day-1")).toBeVisible();

    const day = page.locator("#day-1");
    await day.getByRole("button", { name: "锁定（AI 调整时保留）" }).first().click();
    await expect(day.getByText("已锁定")).toBeVisible();
    // 已锁定的站点不能被替换或删除
    await expect(day.getByRole("button", { name: "换一个" }).first()).toBeDisabled();

    await day.getByRole("button", { name: "换一个" }).nth(1).click();
    const dialog = page.getByRole("dialog", { name: "换一个餐厅" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: /测试备选餐厅/ }).click();
    await expect(page.getByText("已调整：")).toBeVisible();
    expect(rescheduled).not.toBeNull();
    expect(rescheduled!.day).toBe(1);
    expect(rescheduled!.stops[1].place.name).toBe("测试备选餐厅");
  });
});
