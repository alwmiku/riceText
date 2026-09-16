import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const sourceRoots = [
  "apps/web/src",
  "apps/worker/src",
  "packages/contracts/src",
  "packages/document-core/src",
  "packages/server-core/src",
];

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

async function matches(pattern: RegExp): Promise<string[]> {
  const files = (await Promise.all(sourceRoots.map(sourceFiles))).flat();
  const found: string[] = [];
  for (const file of files) {
    const text = await readFile(path.join(root, file), "utf8");
    if (pattern.test(text)) found.push(file);
  }
  return found.sort();
}

describe("ID architecture", () => {
  it("does not generate IDs from timestamps or the legacy generic helper", async () => {
    expect(await matches(/Date\.now\(\)\.toString\(36\)|\bcreateId\s*\(/u)).toEqual([]);
  });

  it("allows direct randomUUID only in the shared generator and internal tokens", async () => {
    expect(await matches(/(?:globalThis\.)?crypto\.randomUUID\s*\(/u)).toEqual([
      "apps/worker/src/app.ts",
      "apps/worker/src/repositories/chapter-repository.ts",
      "packages/contracts/src/ids.ts",
    ]);
  });
});
