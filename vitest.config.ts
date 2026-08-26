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
    testTimeout: 15_000,
    include: ["apps/**/*.test.{ts,tsx}", "packages/**/*.test.{ts,tsx}"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["apps/**/src/**/*.{ts,tsx}", "packages/**/src/**/*.{ts,tsx}"],
      exclude: ["**/*.d.ts", "**/main.tsx", "**/server.ts"],
      thresholds: {
        lines: 80,
        functions: 80,
        statements: 80,
        branches: 75,
      },
    },
  },
});
