import { defineConfig, devices } from "@playwright/test";

/**
 * 端到端测试：页面中的 /api/agent 由测试用 fixture 拦截，不调用真实模型与地图，
 * 因此无需任何密钥即可运行。
 */
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  retries: 0,
  reporter: [["list"]],
  use: {
    baseURL: "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // 关闭平滑滚动与滚动动画，避免点击落在滚动途中的元素上；动效本身另行目测验收
    reducedMotion: "reduce",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } },
    },
    {
      name: "mobile",
      use: {
        ...devices["Desktop Chrome"],
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      TRAVEL_E2E: "1",
      NEXT_PUBLIC_AMAP_JS_KEY: "",
      AMAP_JS_SECURITY_CODE: "",
      AMAP_WEB_SERVICE_KEY: "",
      OPENAI_API_KEY: "",
      DEEPSEEK_API_KEY: "",
      VISION_API_KEY: "",
      NEXT_TELEMETRY_DISABLED: "1",
    },
  },
});
