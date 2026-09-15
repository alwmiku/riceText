// 根配置只服务 @ricetext/web 的 jsdom 测试；Worker 测试跑在 workerd 里，
// 由 apps/worker/vitest.config.ts 自己配置（`pnpm test` 先跑 web，再跑 worker）。
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./test/setup.ts"],
    testTimeout: 30_000,
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/.git/**", "apps/worker/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["apps/**/src/**/*.{ts,tsx}", "packages/**/src/**/*.{ts,tsx}"],
      exclude: [
        "apps/worker/**",
        // 远端 Wrangler/R2 副作用 CLI 由 preview 部署与 checksum smoke 覆盖。
        "scripts/**",
        "**/*.d.ts",
        "**/main.tsx",
        // shadcn 以源码形式 vendored 的基础 UI 组件：仅用于定制样式，不写测试、不计入覆盖率。
        // 注意 color-picker.tsx 是项目自研组件且有配套测试，保留在覆盖率内。
        "**/components/ui/{alert-dialog,button,context-menu,input,popover,scroll-area,separator,sheet,sidebar,skeleton,slider,tooltip}.tsx",
        "**/hooks/use-mobile.ts", // shadcn sidebar 附带的 use-mobile hook
      ],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});
