import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDatabase } from "./db.js";

describe("database seed", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ricetext-db-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("持久化库第二次启动（重跑 seed）不会因校订-章节外键失败", () => {
    const path = join(directory, "seed.sqlite");
    const first = createDatabase({ path });
    first.close();

    // 第二次打开会重跑 seed：上次留下的 suggestions 仍通过 chapter_id
    // 引用旧章节，目录重置必须先释放引用，否则外键约束拦截重建。
    const second = createDatabase({ path });
    const chapters = second
      .prepare("SELECT COUNT(*) AS n FROM chapters WHERE document_id = 'demo-post'")
      .get() as { n: number };
    expect(chapters.n).toBe(5);
    const suggestions = second
      .prepare("SELECT COUNT(*) AS n FROM suggestions WHERE document_id = 'demo-post'")
      .get() as { n: number };
    expect(suggestions.n).toBe(5);
    second.close();
  });

  it("重跑 seed 后五章各有一条 pending 校订建议", () => {
    const path = join(directory, "seed.sqlite");
    const db = createDatabase({ path });
    const rows = db
      .prepare(
        "SELECT chapter_id, status FROM suggestions WHERE document_id = 'demo-post' ORDER BY chapter_id",
      )
      .all() as Array<{ chapter_id: string; status: string }>;
    expect(rows.map((row) => row.chapter_id)).toEqual([
      "chapter-0",
      "chapter-1",
      "chapter-2",
      "chapter-3",
      "chapter-4",
    ]);
    expect(rows.every((row) => row.status === "pending")).toBe(true);
    db.close();
  });
});
