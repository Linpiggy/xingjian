// Explicit user-authorized, single-attempt live test. Never included in check/E2E.
// One museum search + one model call; one JS map initialization and click. No retry.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import nextEnv from "@next/env";

process.env.PLAYWRIGHT_BROWSERS_PATH = "0";
process.env.DEBUG = "";
nextEnv.loadEnvConfig(process.cwd(), true, { info() {}, error() {} });
const privateValues = [
  process.env.AMAP_WEB_SERVICE_KEY,
  process.env.AMAP_JS_SECURITY_CODE,
  process.env.OPENAI_API_KEY,
  process.env.DEEPSEEK_API_KEY,
].filter(Boolean);
const mapOnly = process.argv.includes("--map-only");
const evidenceName = mapOnly ? "amap-js-smoke" : "recommendation-map-smoke";
const evidencePath = `docs/evidence/${evidenceName}-${new Date().toISOString().slice(0, 10)}.json`;
if (existsSync(evidencePath)) {
  throw new Error("Today's attempt already exists. Do not repeat paid requests.");
}
mkdirSync("docs/evidence", { recursive: true });
mkdirSync("test-results", { recursive: true });
const report = {
  kind: mapOnly ? "real_amap_point_smoke" : "real_recommendation_and_map_smoke",
  checkedAt: new Date().toISOString(),
  status: "started",
  inputSummary: {
    city: "杭州",
    dayCount: 2,
    budgetPerPersonFen: 150000,
    interests: ["博物馆"],
  },
  maximumCalls: { placeSearch: 1, model: mapOnly ? 0 : 1, mapInitialization: 1 },
  automaticRetries: 0,
  ai: { status: mapOnly ? "skipped_previously_verified" : "not_started" },
  map: { status: "not_started" },
  privacy: { credentialsInClientText: false, securityCodePassedToBrowser: false },
  limitations: [
    "One sample, not complete account coverage or production rights verification",
    "No raw merchant/model response retained; live screenshots are local and ignored",
    "No route, weather, meals, reservations or full budget verification",
  ],
};
function save() {
  const text = `${JSON.stringify(report, null, 2)}\n`;
  if (privateValues.some((value) => text.includes(value))) {
    throw new Error("Private value detected; evidence not written.");
  }
  writeFileSync(evidencePath, text, "utf8");
  if (readFileSync(evidencePath, "utf8") !== text) {
    throw new Error("Evidence verification failed.");
  }
}
writeFileSync(evidencePath, `${JSON.stringify(report, null, 2)}\n`, {
  flag: "wx",
  encoding: "utf8",
});
if (JSON.parse(readFileSync(evidencePath, "utf8")).status !== "started") {
  throw new Error("Attempt marker verification failed.");
}
const { chromium } = await import("playwright");
const executablePath = join(
  process.cwd(),
  "node_modules/playwright-core/.local-browsers/chromium_headless_shell-1248/chrome-headless-shell-win64/chrome-headless-shell.exe",
);
let browser;
let stage = "browser_setup";
const pageErrors = [];
const network = {
  sdkResponses: 0,
  proxyResponses: 0,
  mapProviderResponses: 0,
  failedRequests: 0,
  proxyHttpStatuses: {},
  businessCodes: [],
};
const checks = [];
try {
  browser = await chromium.launch({ headless: true, executablePath });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
    colorScheme: "light",
  });
  const page = await context.newPage();
  if (mapOnly) {
    await page.route("**/api/recommendations", (route) => route.abort());
  }
  page.on("pageerror", () => pageErrors.push("runtime_error"));
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) {
      pageErrors.push("hydration_error");
    }
  });
  page.on("requestfailed", () => network.failedRequests++);
  page.on("response", (response) => {
    const url = new URL(response.url());
    const proxy = url.pathname.startsWith("/_AMapService/");
    const sdk = url.hostname === "webapi.amap.com";
    const provider = /(?:amap\.com|autonavi\.com)$/.test(url.hostname);
    if (proxy) {
      network.proxyResponses++;
      const status = String(response.status());
      network.proxyHttpStatuses[status] = (network.proxyHttpStatuses[status] ?? 0) + 1;
    } else if (sdk) {
      network.sdkResponses++;
    } else if (provider) {
      network.mapProviderResponses++;
    }
    if (
      (proxy || sdk) &&
      /json|javascript|text/.test(response.headers()["content-type"] ?? "")
    ) {
      checks.push(
        response
          .text()
          .then((text) => {
            if (privateValues.some((value) => text.includes(value))) {
              report.privacy.credentialsInClientText = true;
            }
            for (const match of text.matchAll(/infocode["']?\s*:\s*["']?(\d{5,6})/g)) {
              if (!network.businessCodes.includes(match[1])) {
                network.businessCodes.push(match[1]);
              }
            }
          })
          .catch(() => {}),
      );
    }
  });
  await page.goto("http://127.0.0.1:3000", { waitUntil: "domcontentloaded" });
  const html = await page.content();
  if (privateValues.some((value) => html.includes(value))) {
    report.privacy.credentialsInClientText = true;
    throw new Error("Client privacy verification failed.");
  }
  if (mapOnly) {
    stage = "real_place_search";
    const keyword = "浙江省博物馆孤山馆";
    report.inputSummary = { city: "杭州", keyword };
    const pending = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/places",
      { timeout: 15_000 },
    );
    await page.getByLabel("搜索地点名称").fill(keyword);
    await page.getByRole("button", { name: "搜索地点", exact: true }).click();
    const result = await pending;
    const body = await result.text();
    if (privateValues.some((value) => body.includes(value))) {
      report.privacy.credentialsInClientText = true;
      throw new Error("Place privacy verification failed.");
    }
    const places = JSON.parse(body).places;
    if (
      !result.ok() ||
      !Array.isArray(places) ||
      !places.length ||
      places.some((place) => place.source?.kind !== "provider")
    ) {
      throw new Error("Real center place unavailable; no retry permitted.");
    }
    report.placeSearch = {
      status: "passed",
      httpStatus: result.status(),
      candidateCount: places.length,
    };
    await page.locator(".place-results .place-result").first().waitFor();
  } else {
    stage = "real_ai_request";
    await page.getByRole("button", { name: "AI 智能推荐" }).click();
    await page.getByRole("checkbox", { name: "自然风光", exact: true }).uncheck();
    const started = Date.now();
    const pendingResponse = page.waitForResponse(
      (response) => new URL(response.url()).pathname === "/api/recommendations",
      { timeout: 60_000 },
    );
    await page.getByRole("button", { name: "获取 AI 推荐", exact: true }).click();
    const response = await pendingResponse;
    const text = await response.text();
    if (privateValues.some((value) => text.includes(value))) {
      report.privacy.credentialsInClientText = true;
      throw new Error("Recommendation privacy verification failed.");
    }
    const data = JSON.parse(text);
    report.ai = {
      httpStatus: response.status(),
      durationMs: Date.now() - started,
      status: "failed",
    };
    if (!response.ok()) {
      report.ai.publicErrorCode = typeof data.code === "string" ? data.code : "unknown";
      throw new Error("Real recommendation failed. No retry permitted.");
    }
    const recommendations = data.recommendations;
    if (
      !Array.isArray(recommendations) ||
      recommendations.length < 2 ||
      recommendations.length > 6 ||
      recommendations.some(
        (candidate) =>
          candidate.place?.source?.kind !== "provider" ||
          candidate.place.source.provider !== "amap" ||
          candidate.place.source.coordinateSystem !== "GCJ-02" ||
          candidate.selection?.poiId !== candidate.place.id,
      )
    ) {
      throw new Error("Real recommendation provenance invalid.");
    }
    report.ai = {
      ...report.ai,
      status: "passed",
      model: data.model,
      selectedPlaceCount: recommendations.length,
      coordinateSystem: "GCJ-02",
      userSelectionRequired: true,
    };
    await page.locator(".place-results .place-result").nth(0).getByRole("button").click();
    await page.locator(".place-results .place-result").nth(1).getByRole("button").click();
    await page.getByRole("heading", { name: "已选 2 / 6 个地点" }).waitFor();
    await page.screenshot({
      path: "test-results/live-ai-picker.png",
      fullPage: true,
      caret: "initial",
    });
  }
  save();

  stage = "real_map_complete_and_click";
  report.map.status = "started";
  await page.getByRole("button", { name: "自定义地点", exact: true }).click();
  await page.getByRole("button", { name: "地图选点", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "地图添加地点" });
  await dialog
    .getByText("正在加载真实地图。", { exact: true })
    .waitFor({ state: "hidden", timeout: 25_000 });
  if (
    await dialog.getByRole("heading", { name: /暂不可用|未配置|加载失败/ }).isVisible()
  ) {
    report.map = { status: "failed", reason: "map_not_ready" };
    throw new Error("Map did not become ready; no retry permitted.");
  }
  const proxyConfigured = await page.evaluate(
    () =>
      window._AMapSecurityConfig?.serviceHost === `${location.origin}/_AMapService` &&
      !("securityJsCode" in window._AMapSecurityConfig),
  );
  if (!proxyConfigured) {
    report.privacy.securityCodePassedToBrowser = true;
    throw new Error("Proxy configuration invalid.");
  }
  const canvas = dialog.getByRole("region", { name: "自定义点选地图" });
  report.map.completeEventObservedByUi = true;
  report.map.container = await canvas.locator(".map-canvas").evaluate((element) => ({
    width: element.getBoundingClientRect().width,
    height: element.getBoundingClientRect().height,
    position: getComputedStyle(element).position,
    hasSdkContainerClass: element.classList.contains("amap-container"),
    childCanvasCount: element.querySelectorAll("canvas").length,
  }));
  if (report.map.container.width < 100 || report.map.container.height < 100) {
    throw new Error("SDK container has collapsed.");
  }
  await canvas.screenshot({ path: "test-results/live-basemap.png" });
  const box = await canvas.boundingBox();
  if (!box) {
    throw new Error("Map canvas unavailable.");
  }
  await canvas.click({ position: { x: box.width / 2, y: box.height / 2 } });
  await dialog.getByText(/已选 GCJ-02 位置/).waitFor({ timeout: 5000 });
  await dialog.getByLabel("自定义地点名称").fill("地图测试选点（未核实）");
  await dialog.screenshot({
    path: "test-results/live-point-picker.png",
    caret: "initial",
  });
  await dialog.getByRole("button", { name: "添加到清单", exact: true }).click();
  await page
    .getByRole("heading", { name: `已选 ${mapOnly ? 1 : 3} / 6 个地点` })
    .waitFor();
  await page.getByText("用户地图选点，未核实", { exact: true }).waitFor();
  await Promise.all(checks);
  report.map = {
    ...report.map,
    status: "passed",
    completeEventObservedByUi: true,
    clickProducedGcj02Point: true,
    userPointAdded: true,
    proxyConfigured,
    networkSummary: network,
  };
  report.runtimeErrors = pageErrors.length;
  if (pageErrors.length || report.privacy.credentialsInClientText) {
    throw new Error("Runtime or privacy check failed.");
  }
  report.status = "passed";
} catch {
  if (report.map.status === "started") {
    report.map.status = "failed";
  }
  report.status = "failed";
  report.blockedAt = stage;
  report.runtimeErrors = pageErrors.length;
  process.exitCode = 1;
} finally {
  await Promise.all(checks);
  report.networkSummary = network;
  await browser?.close();
  save();
  console.log(
    JSON.stringify({
      result: report.status,
      blockedAt: report.blockedAt,
      ai: report.ai.status,
      map: report.map.status,
      evidencePath,
    }),
  );
}
