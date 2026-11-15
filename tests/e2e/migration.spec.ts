import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

/** 旧版本保存在浏览器里的行程缺少后来新增的字段，打开时必须被迁移补齐而不是报错 */
test("旧版本本地行程可以正常打开", async ({ page }) => {
  const data = JSON.parse(readFileSync("src/data/samples/hangzhou.json", "utf8"));
  const trip = data.trip;
  delete trip.intercity;
  delete trip.budget.intercity;
  for (const day of trip.days) {
    for (const stop of day.stops) {
      delete stop.place.signatureDishes;
      delete stop.place.tel;
      delete stop.ticketSource;
    }
  }
  const request = { ...data.request };
  delete request.origin;
  const stored = {
    state: {
      order: ["old"],
      records: {
        old: {
          id: "old",
          createdAt: "2026-11-01T00:00:00.000Z",
          request,
          trip,
          liveDays: [],
          livePlaces: [],
          trace: [],
          run: "idle",
          error: null,
          versions: [],
        },
      },
    },
    version: 2,
  };
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(
    (value) => localStorage.setItem("xingjian-trips", value),
    JSON.stringify(stored),
  );
  await page.goto("/plan/old");
  await expect(page.locator("#day-1")).toBeVisible();
  await expect(page.getByText("推荐点").first()).toBeVisible();
  expect(errors).toEqual([]);
  const migrated = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("xingjian-trips") ?? "{}"),
  );
  expect(migrated.version).toBe(4);
  expect(migrated.state.records.old.trip.days[0].stops[0].place.signatureDishes).toEqual(
    [],
  );
});
