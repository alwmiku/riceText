import { defineConfig, devices } from "@playwright/test";

const localBrowser = process.env.CI ? {} : { channel: "chrome" as const };

export default defineConfig({
  testDir: "./e2e-password",
  workers: 1,
  retries: process.env.CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://127.0.0.1:5174",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  webServer: [
    {
      command: "pnpm cf:e2e:prepare && pnpm --filter @ricetext/worker exec wrangler dev --port 8788 --persist-to ../../.data/password-e2e-state",
      url: "http://127.0.0.1:8788/api/health",
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        CF_E2E_PERSIST_TO: ".data/password-e2e-state",
        CF_E2E_EMPTY_DOCUMENTS: "true",
      },
    },
    {
      command: "pnpm --filter @ricetext/web exec vite --host 127.0.0.1 --mode session --port 5174",
      url: "http://127.0.0.1:5174",
      reuseExistingServer: false,
      timeout: 120_000,
      env: { VITE_PROXY_TARGET: "http://127.0.0.1:8788" },
    },
  ],
  projects: [
    {
      name: "password-session",
      use: { ...devices["Desktop Chrome"], ...localBrowser },
    },
  ],
});
