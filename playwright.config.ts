// E2E 的唯一后端是本地 Wrangler/D1：真实浏览器访问 Vite，Vite 把 /api 代理到 Worker。
//
// E2E 用独立的模拟状态目录（.data/cloudflare-e2e-state）：测试准备每次都要重建 D1，
// 不能拿开发者 `pnpm --filter @ricetext/worker dev` 正在用的 .wrangler/state 开刀
// ——既会撞上文件占用（Windows 上 prepare 直接 EBUSY），也会把本地库清掉。
import { defineConfig, devices } from "@playwright/test";

const localBrowser = process.env.CI ? {} : { channel: "chrome" as const };
const e2eState = ".data/cloudflare-e2e-state";

export default defineConfig({
  testDir: "./e2e",
  // 单个 Worker 串行执行：chromium 与 mobile 两个 project 共享同一个本地 D1 与
  // Vite 代理，并行写同一文档会出现 revision 竞争并互相拖慢到加载超时。
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
      command:
        "pnpm cf:e2e:prepare && pnpm --filter @ricetext/worker exec wrangler dev --persist-to ../../" +
        e2eState,
      url: "http://127.0.0.1:8787/api/health",
      // 必须每次重建：复用旧 D1 会让上一轮的 revision 与文章列表污染断言。
      reuseExistingServer: false,
      timeout: 120_000,
      env: { CF_E2E_PERSIST_TO: e2eState },
    },
    {
      command: "pnpm --filter @ricetext/web dev",
      url: "http://127.0.0.1:5173",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_PROXY_TARGET: "http://127.0.0.1:8787" },
    },
  ],
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], ...localBrowser } },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"], viewport: { width: 390, height: 844 }, ...localBrowser },
    },
  ],
});
