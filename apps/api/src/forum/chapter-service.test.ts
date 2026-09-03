import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createDatabase } from "../db.js";
import { ChapterService } from "./chapter-service.js";

const content = {
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }],
};

describe("ChapterService chapter ownership", () => {
  let db: DatabaseSync;
  let service: ChapterService;

  beforeEach(() => {
    db = createDatabase({ path: ":memory:", seed: false });
    const now = new Date(0).toISOString();
    db.prepare(
      "INSERT INTO users(id, name, role, is_friend, bio) VALUES (?, ?, ?, 0, '')",
    ).run("author", "作者", "author");
    for (const id of ["article-a", "article-b"]) {
      db.prepare(
        "INSERT INTO documents(id, title, schema_version, current_revision, created_by, created_at, updated_at) VALUES (?, ?, 1, 0, ?, ?, ?)",
      ).run(id, id, "author", now, now);
    }
    service = new ChapterService(db);
  });

  afterEach(() => db.close());

  it("rejects a chapter ID owned by another document without overwriting it", () => {
    service.saveChapter("article-a", "shared-chapter", {
      title: "文章 A",
      order: 0,
      content,
      hash: "hash-a",
      baseRevision: 0,
    });

    expect(() =>
      service.saveChapter("article-b", "shared-chapter", {
        title: "文章 B",
        order: 0,
        content,
        hash: "hash-b",
        baseRevision: 0,
      }),
    ).toThrowError(expect.objectContaining({ code: "CHAPTER_ID_CONFLICT", status: 409 }));

    expect(
      db.prepare(
        "SELECT document_id, title, content_hash, revision FROM chapters WHERE id = ?",
      ).get("shared-chapter"),
    ).toMatchObject({
      document_id: "article-a",
      title: "文章 A",
      content_hash: "hash-a",
      revision: 1,
    });
  });
});
