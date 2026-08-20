import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { writeOpenApi } from "./generate-openapi.js";

describe("OpenAPI 文件生成入口", () => {
  it("把共享契约序列化为指定目录下的 openapi.yaml", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ricetext-openapi-"));
    try {
      await writeOpenApi(directory);
      const output = await readFile(join(directory, "openapi.yaml"), "utf8");

      expect(output).toContain("openapi: 3.1.0");
      expect(output).toContain("title: RiceText 论坛与小说富文本 API");
      expect(output).toContain("/api/documents/{documentId}:");
      expect(output).toContain("x-implementation-status: mock");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
