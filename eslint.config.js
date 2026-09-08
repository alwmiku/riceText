import js from "@eslint/js";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettierConfig from "eslint-config-prettier/flat";
import architecture from "./test/architecture/dependency-rules.mjs";

export default defineConfig(
  {
    ignores: [
      "**/dist/**",
      "**/dist-*/**",
      "**/.wrangler/**",
      "**/coverage/**",
      "**/node_modules/**",
      "playwright-report/**",
      "test-results/**",
      ".data/**",
      // 本地临时脚本不属于应用源码。
      ".tmp/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["tools/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        URL: "readonly",
      },
    },
  },
  {
    files: ["**/*.cjs"],
    languageOptions: {
      globals: { module: "readonly", require: "readonly" },
      sourceType: "commonjs",
    },
  },
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: ["apps/web/src/**/*.{ts,tsx}", "packages/{document-core,server-core}/src/**/*.{ts,tsx}"],
    plugins: { architecture },
    rules: { "architecture/dependency-boundaries": "error" },
  },
  {
    files: ["**/*.test.{ts,tsx}", "**/test/**", "**/vite.config.ts", "playwright.config.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
  // 排版统一由 Prettier 处理，关闭可能与其冲突的 ESLint 格式规则。
  prettierConfig,
);
