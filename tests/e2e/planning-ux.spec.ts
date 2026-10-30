import { test, expect } from "@playwright/test";
import { fixtureItinerary, fixtureCandidates } from "../fixtures/itinerary";
import { tripBriefSchema } from "../../src/lib/trip-brief-contracts";

test("generation has truthful staged progress, real day counters and keeps cancellation available", async ({
  page,
}, testInfo) => {
  await page.exposeFunction("makePlanningFixture", (brief: unknown) =>
    fixtureItinerary(tripBriefSchema.parse(brief)),
  );
  await page.addInitScript(() => {
    type Controls = Window & {
      makePlanningFixture?: (brief: unknown) => Promise<unknown>;
      advancePlanning?: (
        stage: "places" | "model" | "routes",
        work?: { completed: number; total: number },
      ) => void;
      finishPlanning?: () => void;
    };
    const target = window as Controls;
    const original = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        location.href,
      );
      if (url.pathname !== "/api/itineraries") {
        return original(input, init);
      }
      if (!target.makePlanningFixture) {
        throw new Error("Missing local planning fixture binding");
      }
      const plan = await target.makePlanningFixture(JSON.parse(String(init?.body)));
      const encoder = new TextEncoder();
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          const send = (event: unknown) =>
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          target.advancePlanning = (stage, work) =>
            send({
              type: "progress",
              stage,
              message: `fixture 阶段：${stage}`,
              ...(work ? { work } : {}),
            });
          target.finishPlanning = () => {
            send({ type: "result", plan });
            controller.close();
          };
          init?.signal?.addEventListener(
            "abort",
            () => controller.error(new DOMException("Cancelled", "AbortError")),
            { once: true },
          );
          send({ type: "progress", stage: "places", message: "fixture 查找公开地点" });
        },
      });
      return new Response(stream, {
        headers: { "Content-Type": "application/x-ndjson" },
      });
    };
  });
  await page.goto("/plan");
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByLabel("旅行天数").fill("2");
  await page.getByLabel("我确认本次生成会使用模型与地图查询配额").check();
  await page.getByRole("button", { name: "生成我的完整方案" }).click();
  const progress = page.getByRole("region", { name: "方案生成进度" });
  await expect(progress).toBeVisible();
  const bar = progress.getByRole("progressbar", { name: "当前阶段进度" });
  await expect(bar).not.toHaveAttribute("aria-valuenow");
  await expect(page.getByRole("button", { name: "取消生成", exact: true })).toBeVisible();
  await page.evaluate(() => {
    const controls = window as Window & {
      advancePlanning?: (
        stage: string,
        work?: { completed: number; total: number },
      ) => void;
    };
    controls.advancePlanning?.("model");
  });
  await expect(progress.locator('[aria-current="step"]')).toHaveText("编排行程");
  await expect(bar).not.toHaveAttribute("aria-valuenow");
  await page.evaluate(() => {
    const controls = window as Window & {
      advancePlanning?: (
        stage: string,
        work?: { completed: number; total: number },
      ) => void;
    };
    controls.advancePlanning?.("routes", { completed: 1, total: 2 });
  });
  await expect(bar).toHaveAttribute("aria-valuenow", "1");
  await expect(bar).toHaveAttribute("aria-valuemax", "2");
  await expect(progress).toContainText("路线核对 1/2 天");
  await page.screenshot({
    path: `test-results/${testInfo.project.name}-generation-progress.png`,
    animations: "disabled",
  });
  await page.evaluate(() =>
    (window as Window & { finishPlanning?: () => void }).finishPlanning?.(),
  );
  await expect(progress).toHaveCount(0);
  await expect(page.locator(".trip-app")).toHaveAttribute("data-plan-revision", "1");
  await expect(
    page.getByRole("heading", { name: "在城市的文化与烟火之间" }),
  ).toBeVisible();
});

test("public place search is part of full planning, stays explicit and appends to required names without starting AI", async ({
  page,
}) => {
  let searchCalls = 0;
  let modelCalls = 0;
  await page.route("**/api/places?*", (route) => {
    searchCalls += 1;
    return route.fulfill({
      json: {
        places: fixtureCandidates()
          .filter((item) => item.kind === "visit")
          .slice(0, 2)
          .map((item) => item.place),
      },
    });
  });
  await page.route("**/api/itineraries", (route) => {
    modelCalls += 1;
    return route.abort();
  });
  await page.goto("/plan");
  await expect(page.getByRole("tab", { name: /手动选点/ })).toHaveCount(0);
  await expect(page.getByText("手动草稿工具", { exact: true })).toBeVisible();
  await page.getByLabel("目的地城市").fill("测试城市");
  await page.getByRole("button", { name: "偏好与必去", exact: true }).click();
  await page.getByText("搜索并补充必去地点", { exact: true }).click();
  await page.getByLabel("搜索必去地点", { exact: true }).fill("文化场馆");
  expect(searchCalls).toBe(0);
  await page.getByRole("button", { name: "查找地点", exact: true }).click();
  const add = page.getByRole("button", { name: "将测试文化场馆1加入必去", exact: true });
  await expect(add).toBeVisible();
  await add.click();
  await expect(
    page.getByRole("textbox", { name: "必去公共地点", exact: true }),
  ).toHaveValue("测试文化场馆1");
  await expect(add).toBeDisabled();
  await page.getByRole("button", { name: "行程概况", exact: true }).click();
  await page.getByLabel("目的地城市").fill("另一个城市");
  await page.getByRole("button", { name: "偏好与必去", exact: true }).click();
  await expect(add).toHaveCount(0);
  expect(searchCalls).toBe(1);
  expect(modelCalls).toBe(0);
});
