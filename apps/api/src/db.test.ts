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
    first
      .prepare(
        "UPDATE chapters SET revision = 9, updated_at = '2026-09-01T18:56:00.000Z' WHERE id = 'chapter-1'",
      )
      .run();
    first.close();

    // 第二次打开会重跑 seed，但只能更新目录元数据，不能清空章节版本和时间。
    const second = createDatabase({ path });
    const chapters = second
      .prepare("SELECT COUNT(*) AS n FROM chapters WHERE document_id = 'demo-post'")
      .get() as { n: number };
    expect(chapters.n).toBe(5);
    const preserved = second
      .prepare("SELECT revision, updated_at FROM chapters WHERE id = 'chapter-1'")
      .get() as { revision: number; updated_at: string };
    expect(preserved).toEqual({
      revision: 9,
      updated_at: "2026-09-01T18:56:00.000Z",
    });
    const suggestions = second
      .prepare("SELECT COUNT(*) AS n FROM suggestions WHERE document_id = 'demo-post'")
      .get() as { n: number };
    expect(suggestions.n).toBe(5);
    second.close();
  });

  it("V6 创建批量校订表并可在持久化库重启后读取", () => {
    const path = join(directory, "batch.sqlite");
    const first = createDatabase({ path });
    first
      .prepare(
        "INSERT INTO suggestion_batches(id, document_id, chapter_id, chapter_title, base_revision, before_content_json, after_content_json, steps_json, reason, status, author_id, created_at) VALUES ('batch-test', 'demo-post', 'chapter-1', '第一章', 1, '{\"type\":\"doc\",\"content\":[]}', '{\"type\":\"doc\",\"content\":[]}', '[{\"stepType\":\"replace\",\"from\":1,\"to\":1}]', '', 'pending', 'reader', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    first.close();

    const second = createDatabase({ path, seed: false });
    const row = second
      .prepare("SELECT status, chapter_id FROM suggestion_batches WHERE id = 'batch-test'")
      .get() as { status: string; chapter_id: string };
    expect(row).toEqual({ status: "pending", chapter_id: "chapter-1" });
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
