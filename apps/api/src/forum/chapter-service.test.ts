import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
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

  it("stores the same chapter ID independently in different documents", () => {
    service.saveChapter("article-a", "shared-chapter", {
      title: "文章 A",
      order: 0,
      content,
      hash: "hash-a",
      baseRevision: 0,
    });

    service.saveChapter("article-b", "shared-chapter", {
      title: "文章 B",
      order: 0,
      content,
      hash: "hash-b",
      baseRevision: 0,
    });

    expect(service.chapterContent("article-a", "shared-chapter")).toMatchObject({
      id: "shared-chapter",
      documentId: "article-a",
      content,
    });
    expect(service.chapterContent("article-b", "shared-chapter")).toMatchObject({
      id: "shared-chapter",
      documentId: "article-b",
      title: "文章 B",
    });
    db.prepare(
      "INSERT INTO suggestions(" +
        "id, document_id, chapter_id, chapter_title, line_no, line_text, " +
        "from_text, to_text, reason, status, author_id, created_at" +
        ") VALUES (?, ?, ?, ?, 1, '', '', '', '', 'pending', ?, ?)",
    ).run(
      "suggestion-b",
      "article-b",
      "shared-chapter",
      "文章 B",
      "author",
      new Date(0).toISOString(),
    );
    expect(service.deleteChapter("article-a", "shared-chapter")).toEqual({
      id: "shared-chapter",
      deleted: true,
    });
    expect(service.chapterContent("article-b", "shared-chapter")).toMatchObject({
      documentId: "article-b",
    });
    expect(
      db
        .prepare("SELECT chapter_id FROM suggestions WHERE id = ?")
        .get("suggestion-b"),
    ).toEqual({ chapter_id: "shared-chapter" });
    service.saveChapter("article-a", "converted-chapter", {
      title: "转换章节",
      order: 1,
      content: {
        type: "doc",
        content: [
          {
            type: "longTextBlock",
            attrs: { title: "转换章节", text: "第一行\r\n\r\n第三行" },
          },
        ],
      } as never,
      hash: "converted-hash",
      baseRevision: 0,
    });
    const converted = service.chapterContent("article-a", "converted-chapter");
    expect(converted.content.content.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(JSON.stringify(converted.content)).not.toContain("longTextBlock");

    expect(
      db.prepare(
        "SELECT document_id, title, content_hash, revision FROM chapters WHERE document_id = ? AND id = ?",
      ).get("article-b", "shared-chapter"),
    ).toMatchObject({
      document_id: "article-b",
      title: "文章 B",
      content_hash: "hash-b",
      revision: 1,
    });
  });
});

describe("ChapterService batch upload", () => {
  let db: DatabaseSync;
  let service: ChapterService;

  const batchContent = {
    type: "doc" as const,
    content: [
      { type: "paragraph", content: [{ type: "text", text: "批量正文" }] },
    ],
  };

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

  it("删除中间章节后压紧后续顺序并递增其版本", () => {
    service.saveChaptersBatch("article-a", [
      { id: "a", title: "A", order: 0, content: batchContent, hash: "a", baseRevision: 0 },
      { id: "b", title: "B", order: 1, content: batchContent, hash: "b", baseRevision: 0 },
      { id: "c", title: "C", order: 2, content: batchContent, hash: "c", baseRevision: 0 },
    ]);

    expect(service.deleteChapter("article-a", "b")).toEqual({
      id: "b",
      deleted: true,
    });
    expect(service.chapters("article-a")).toMatchObject([
      { id: "a", order: 0, revision: 1 },
      { id: "c", order: 1, revision: 2 },
    ]);
  });

  afterEach(() => db.close());

  it("整批预校验：baseRevision 过期时整批 409 且不发生部分提交", () => {
    service.saveChaptersBatch("article-a", [
      { id: "b1", title: "第一章", order: 0, content: batchContent, hash: "hash-1", baseRevision: 0 },
      { id: "b2", title: "第二章", order: 1, content: batchContent, hash: "hash-2", baseRevision: 0 },
    ]);
    expect(() =>
      service.saveChaptersBatch("article-a", [
        { id: "b1", title: "第一章", order: 0, content: batchContent, hash: "hash-1-new", baseRevision: 0 },
        { id: "b3", title: "第三章", order: 2, content: batchContent, hash: "hash-3", baseRevision: 0 },
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: "CHAPTER_REVISION_CONFLICT",
        status: 409,
        details: expect.objectContaining({ chapterId: "b1", currentRevision: 1 }),
      }),
    );
    // b3 未被部分写入。
    const stored = db
      .prepare("SELECT content_hash FROM chapters WHERE id = ?")
      .get("b3") as { content_hash: string | null } | undefined;
    expect(stored?.content_hash).toBeUndefined();
  });

  it("同 hash 幂等重试返回 unchanged 且不重复递增 revision", () => {
    const first = service.saveChaptersBatch("article-a", [
      { id: "b1", title: "第一章", order: 0, content: batchContent, hash: "hash-1", baseRevision: 0 },
    ]);
    expect(first).toEqual([
      { id: "b1", title: "第一章", order: 0, revision: 1, status: "saved" },
    ]);
    // 上次响应丢失后的重试：即使 baseRevision 仍是 0，也返回 unchanged 与当前 revision。
    const retried = service.saveChaptersBatch("article-a", [
      { id: "b1", title: "第一章", order: 0, content: batchContent, hash: "hash-1", baseRevision: 0 },
    ]);
    expect(retried).toEqual([
      { id: "b1", title: "第一章", order: 0, revision: 1, status: "unchanged" },
    ]);
    const row = db
      .prepare("SELECT revision FROM chapters WHERE id = ?")
      .get("b1") as { revision: number };
    expect(row.revision).toBe(1);
  });

  it("跨文章复用 ID，但目标 order 占用时拒绝自动搬移", () => {
    service.saveChaptersBatch("article-a", [
      { id: "shared", title: "共享章", order: 0, content: batchContent, hash: "hash-0", baseRevision: 0 },
    ]);
    expect(
      service.saveChaptersBatch("article-b", [
        { id: "shared", title: "B 的共享章", order: 0, content: batchContent, hash: "hash-b", baseRevision: 0 },
        { id: "b-other", title: "B 其他章", order: 1, content: batchContent, hash: "hash-o", baseRevision: 0 },
      ]),
    ).toHaveLength(2);
    expect(service.chapterContent("article-a", "shared").title).toBe("共享章");
    expect(service.chapterContent("article-b", "shared").title).toBe("B 的共享章");

    expect(() => service.saveChaptersBatch("article-a", [
      { id: "new-0", title: "新章", order: 0, content: batchContent, hash: "hash-n", baseRevision: 0 },
    ])).toThrowError(expect.objectContaining({ code: "CHAPTER_ORDER_CONFLICT" }));
    expect(service.chapters("article-a")).toMatchObject([
      { id: "shared", order: 0, revision: 1 },
    ]);
    // 批内重复目标顺序同样整批 409。
    expect(() =>
      service.saveChaptersBatch("article-a", [
        { id: "dup-0", title: "重复 0", order: 1, content: batchContent, hash: "hash-d", baseRevision: 0 },
        { id: "dup-1", title: "重复 1", order: 1, content: batchContent, hash: "hash-e", baseRevision: 0 },
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "CHAPTER_ORDER_CONFLICT", details: { chapterId: "dup-1" } }),
    );
  });

  it("乱序到达的上传批次只在完整验收后原子发布", () => {
    const manifest = [
      { id: "a", title: "A", order: 0, hash: "ha" },
      { id: "b", title: "B", order: 1, hash: "hb" },
      { id: "c", title: "C", order: 2, hash: "hc" },
    ];
    const hash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
    const upload = service.createUpload("article-a", hash, manifest.length);
    service.stageUploadBatch("article-a", upload.uploadId, [
      { ...manifest[2]!, content: batchContent, baseRevision: 0 },
    ]);
    expect(() => service.completeUpload("article-a", upload.uploadId)).toThrowError(
      expect.objectContaining({ code: "CHAPTER_UPLOAD_INCOMPLETE" }),
    );
    expect(service.chapters("article-a")).toEqual([]);
    service.stageUploadBatch("article-a", upload.uploadId, [
      { ...manifest[0]!, content: batchContent, baseRevision: 0 },
      { ...manifest[1]!, content: batchContent, baseRevision: 0 },
    ]);
    expect(service.chapters("article-a")).toEqual([]);
    service.completeUpload("article-a", upload.uploadId);
    expect(service.chapters("article-a")).toMatchObject([
      { id: "a", order: 0 },
      { id: "b", order: 1 },
      { id: "c", order: 2 },
    ]);
  });

  it("保留空行和标准节点（longTextBlock 转换保护）", () => {
    service.saveChaptersBatch("article-a", [
      {
        id: "converted",
        title: "转换章",
        order: 0,
        content: {
          type: "doc",
          content: [
            {
              type: "longTextBlock",
              attrs: { title: "转换章", text: "第一行\r\n\r\n第三行" },
            },
          ],
        } as never,
        hash: "hash-c",
        baseRevision: 0,
      },
    ]);
    const stored = service.chapterContent("article-a", "converted");
    expect(stored.content.content.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(stored.content.content[3]).toMatchObject({
      type: "paragraph",
      content: [{ type: "text", text: "第三行" }],
    });
    expect(JSON.stringify(stored.content)).not.toContain("longTextBlock");
  });

  it("换序暂存：首次 staged、幂等 unchanged、重试不再递增版本", () => {
    service.saveChaptersBatch("article-a", [
      { id: "a", title: "A", order: 0, content: batchContent, hash: "hash-a", baseRevision: 0 },
      { id: "b", title: "B", order: 1, content: batchContent, hash: "hash-b", baseRevision: 0 },
    ]);
    const first = service.stageChapterReorder("article-a", [
      { id: "a", temporaryOrder: 2, baseRevision: 1 },
      { id: "b", temporaryOrder: 3, baseRevision: 1 },
    ]);
    expect(first).toEqual([
      { id: "a", revision: 2, status: "staged" },
      { id: "b", revision: 2, status: "staged" },
    ]);
    // 当前顺序等于临时顺序且版本等于 baseRevision：幂等返回，不重复递增。
    const idempotent = service.stageChapterReorder("article-a", [
      { id: "a", temporaryOrder: 2, baseRevision: 2 },
      { id: "b", temporaryOrder: 3, baseRevision: 2 },
    ]);
    expect(idempotent).toEqual([
      { id: "a", revision: 2, status: "unchanged" },
      { id: "b", revision: 2, status: "unchanged" },
    ]);
    // 上次响应丢失后的重试（版本 = baseRevision + 1 且顺序一致）：返回当前版本。
    const replayed = service.stageChapterReorder("article-a", [
      { id: "a", temporaryOrder: 2, baseRevision: 1 },
      { id: "b", temporaryOrder: 3, baseRevision: 1 },
    ]);
    expect(replayed).toEqual([
      { id: "a", revision: 2, status: "staged" },
      { id: "b", revision: 2, status: "staged" },
    ]);
    const rows = db
      .prepare("SELECT id, revision, sort_order FROM chapters WHERE id IN ('a', 'b') ORDER BY id")
      .all() as Array<{ id: string; revision: number; sort_order: number }>;
    expect(rows).toEqual([
      { id: "a", revision: 2, sort_order: 2 },
      { id: "b", revision: 2, sort_order: 3 },
    ]);
  });

  it("换序暂存：按文章隔离，并拒绝临时顺序占用与版本过期", () => {
    service.saveChaptersBatch("article-a", [
      { id: "a", title: "A", order: 0, content: batchContent, hash: "hash-a", baseRevision: 0 },
      { id: "b", title: "B", order: 1, content: batchContent, hash: "hash-b", baseRevision: 0 },
    ]);
    expect(() =>
      service.stageChapterReorder("article-a", [
        { id: "a", temporaryOrder: 1, baseRevision: 1 },
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "CHAPTER_ORDER_CONFLICT", details: { chapterId: "a" } }),
    );
    expect(() =>
      service.stageChapterReorder("article-a", [
        { id: "b", temporaryOrder: 3, baseRevision: 0 },
      ]),
    ).toThrowError(
      expect.objectContaining({
        code: "CHAPTER_REVISION_CONFLICT",
        details: expect.objectContaining({ chapterId: "b" }),
      }),
    );
    service.saveChaptersBatch("article-b", [
      { id: "a", title: "B-A", order: 0, content: batchContent, hash: "hash-ba", baseRevision: 0 },
    ]);
    expect(
      service.stageChapterReorder("article-b", [
        { id: "a", temporaryOrder: 5, baseRevision: 1 },
      ]),
    ).toEqual([{ id: "a", revision: 2, status: "staged" }]);
    expect(() =>
      service.stageChapterReorder("article-a", [
        { id: "a", temporaryOrder: 2, baseRevision: 1 },
        { id: "b", temporaryOrder: 2, baseRevision: 1 },
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "CHAPTER_ORDER_CONFLICT", details: { chapterId: "b" } }),
    );
  });
});

