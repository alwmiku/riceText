import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
// 只扫描会进入浏览器或 Worker 的生产源码，测试夹具中的历史 ID 不属于生成路径。
const sourceRoots = [
  "apps/web/src",
  "apps/worker/src",
  "packages/contracts/src",
  "packages/document-core/src",
  "packages/server-core/src",
];

/** 递归收集生产 TypeScript 文件，并排除单元测试。 */
async function sourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const relative = path.posix.join(directory.replaceAll("\\", "/"), entry.name);
      if (entry.isDirectory()) return sourceFiles(relative);
      if (!/\.tsx?$/u.test(entry.name) || /\.test\.tsx?$/u.test(entry.name)) return [];
      return [relative];
    }),
  );
  return nested.flat();
}

/** 返回包含禁用生成表达式的仓库相对路径，便于失败时直接定位。 */
async function matches(pattern: RegExp): Promise<string[]> {
  const files = (await Promise.all(sourceRoots.map(sourceFiles))).flat();
  const found: string[] = [];
  for (const file of files) {
    const text = await readFile(path.join(root, file), "utf8");
    if (pattern.test(text)) found.push(file);
  }
  return found.sort();
}

describe("ID 架构约束", () => {
  it("禁止使用时间戳或旧通用工具生成 ID", async () => {
    expect(await matches(/Date\.now\(\)\.toString\(36\)|\bcreateId\s*\(/u)).toEqual([]);
  });

  it("仅共享生成器和内部令牌可以直接调用 randomUUID", async () => {
    expect(await matches(/(?:globalThis\.)?crypto\.randomUUID\s*\(/u)).toEqual([
      "apps/worker/src/app.ts",
      "apps/worker/src/repositories/chapter-repository.ts",
      "packages/contracts/src/ids.ts",
    ]);
  });
});
