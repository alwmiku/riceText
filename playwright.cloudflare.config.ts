// 该配置让真实浏览器访问 Vite，并把全部 API 请求送入本地 Wrangler/D1。
import { defineConfig, devices } from "@playwright/test";

const localBrowser = process.env.CI ? {} : { channel: "chrome" as const };

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5173",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm cf:e2e:prepare && pnpm --filter @ricetext/worker dev",
      url: "http://127.0.0.1:8787/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: "pnpm --filter @ricetext/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_API_ROOT: "http://127.0.0.1:8787" },
    },
  ],
  projects: [
    {
      name: "cloudflare-chromium",
      use: { ...devices["Desktop Chrome"], ...localBrowser },
    },
    {
      name: "cloudflare-mobile",
      use: {
        ...devices["Pixel 7"],
        viewport: { width: 390, height: 844 },
        ...localBrowser,
      },
    },
  ],
});
