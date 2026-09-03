// Worker/D1 上的批量章节语义与数百章实测（本地 miniflare D1，不触碰用户数据）。
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const now = "2026-08-20T08:00:00.000Z";

const contentFor = (text: string) => ({
  type: "doc" as const,
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
});

const batchRequest = (
  novelId: string,
  chapters: Array<{
    id: string;
    title: string;
    order: number;
    content: unknown;
    hash: string;
    baseRevision: number;
  }>,
) =>
  exports.default.fetch(
    new Request("http://example.com/api/forum/novels/" + novelId + "/chapters/batch", {
      method: "POST",
      headers: { "content-type": "application/json", "x-user-id": "author" },
      body: JSON.stringify({ chapters }),
    }),
  );

const stageRequest = (
  novelId: string,
  chapters: Array<{ id: string; temporaryOrder: number; baseRevision: number }>,
) =>
  exports.default.fetch(
    new Request(
      "http://example.com/api/forum/novels/" + novelId + "/chapters/reorder-stage",
      {
        method: "POST",
        headers: { "content-type": "application/json", "x-user-id": "author" },
        body: JSON.stringify({ chapters }),
      },
    ),
  );

/** 章节 id 为全局主键，按文章前缀隔离；order 从 0 连续。 */
function chapterId(novelId: string, index: number): string {
  return novelId + "-" + index;
}

async function seedNovel(novelId: string, count: number): Promise<void> {
  const nowValue = now;
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO users(id, name, role, is_friend, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("author", "林见", "author", 1, "作者", nowValue, nowValue),
    env.DB.prepare(
      "INSERT INTO documents(id, title, schema_version, current_revision, created_by, created_at, updated_at) VALUES (?, ?, 1, 0, ?, ?, ?)",
    ).bind(novelId, novelId, "author", nowValue, nowValue),
    env.DB.prepare(
      "INSERT INTO document_acl(document_id, user_id, permission, created_at) VALUES (?, ?, 'admin', ?)",
    ).bind(novelId, "author", nowValue),
  ]);
  // 每批最多 20 条写入，仍低于 D1 一次调用 50 条语句上限。
  for (let offset = 0; offset < count; offset += 20) {
    const rows = [];
    for (let index = offset; index < Math.min(offset + 20, count); index += 1) {
      rows.push(
        env.DB.prepare(
          "INSERT INTO chapters(id, title, sort_order, document_id, revision, content_json, content_hash, updated_at, hidden) VALUES (?, ?, ?, ?, 1, ?, ?, ?, 0)",
        ).bind(
          chapterId(novelId, index),
          "章节 " + index,
          index,
          novelId,
          JSON.stringify(contentFor("旧正文 " + index)),
          "old-" + index,
          nowValue,
        ),
      );
    }
    await env.DB.batch(rows);
  }
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM suggestion_review_guards"),
    env.DB.prepare("DELETE FROM suggestion_batches"),
    env.DB.prepare("DELETE FROM suggestions"),
    env.DB.prepare("DELETE FROM document_mutations"),
    env.DB.prepare("DELETE FROM chapters"),
    env.DB.prepare("DELETE FROM comment_votes"),
    env.DB.prepare("DELETE FROM comment_replies"),
    env.DB.prepare("DELETE FROM reply_receipts"),
    env.DB.prepare("DELETE FROM reply_gates"),
    env.DB.prepare("DELETE FROM comment_threads"),
    env.DB.prepare("DELETE FROM document_revisions"),
    env.DB.prepare("DELETE FROM document_acl"),
    env.DB.prepare("DELETE FROM documents"),
    env.DB.prepare("DELETE FROM auth_login_states"),
    env.DB.prepare("DELETE FROM login_rate_limits"),
    env.DB.prepare("DELETE FROM auth_sessions"),
    env.DB.prepare("DELETE FROM auth_identities"),
    env.DB.prepare("DELETE FROM dice_rolls"),
    env.DB.prepare("DELETE FROM poll_vote_options"),
    env.DB.prepare("DELETE FROM poll_votes"),
    env.DB.prepare("DELETE FROM poll_options"),
    env.DB.prepare("DELETE FROM polls"),
    env.DB.prepare("DELETE FROM attachment_purchases"),
    env.DB.prepare("DELETE FROM attachments"),
    env.DB.prepare("DELETE FROM assets"),
    env.DB.prepare("DELETE FROM wallets"),
    env.DB.prepare("DELETE FROM users"),
  ]);
});

describe("Worker chapter batch", () => {
  it("批量保存：200 保存、同 hash 幂等、整批 409 且不发生部分提交", async () => {
    await seedNovel("batch-novel", 3);
    const item = (
      id: string,
      title: string,
      order: number,
      hash: string,
      baseRevision = 1,
    ) => ({ id, title, order, content: contentFor(title), hash, baseRevision });
    const saved = await batchRequest("batch-novel", [
      item(chapterId("batch-novel", 0), "第一章（新）", 0, "new-0"),
      item(chapterId("batch-novel", 1), "第二章（新）", 1, "new-1"),
    ]);
    expect(saved.status, await saved.clone().text()).toBe(200);
    await expect(saved.json()).resolves.toEqual({
      chapters: [
        { id: chapterId("batch-novel", 0), title: "第一章（新）", order: 0, revision: 2, status: "saved" },
        { id: chapterId("batch-novel", 1), title: "第二章（新）", order: 1, revision: 2, status: "saved" },
      ],
    });

    // 幂等重试：hash 与内容一致时返回 unchanged，服务端版本不再递增。
    const replayed = await batchRequest("batch-novel", [
      item(chapterId("batch-novel", 0), "第一章（新）", 0, "new-0"),
    ]);
    expect(replayed.status).toBe(200);
    await expect(replayed.json()).resolves.toEqual({
      chapters: [
        { id: chapterId("batch-novel", 0), title: "第一章（新）", order: 0, revision: 2, status: "unchanged" },
      ],
    });
    const revisions = await env.DB.prepare(
      "SELECT id, revision, content_hash FROM chapters WHERE id IN (?, ?) ORDER BY id",
    )
      .bind(chapterId("batch-novel", 0), chapterId("batch-novel", 1))
      .all<{ id: string; revision: number; content_hash: string }>();
    expect(revisions.results).toEqual([
      { id: chapterId("batch-novel", 0), revision: 2, content_hash: "new-0" },
      { id: chapterId("batch-novel", 1), revision: 2, content_hash: "new-1" },
    ]);

    // 整批 409：第 2 章 baseRevision 过期；第 3 章不发生部分提交。
    const conflict = await batchRequest("batch-novel", [
      item(chapterId("batch-novel", 1), "第二章", 1, "another-1", 0),
      item(chapterId("batch-novel", 2), "第三章", 2, "new-2"),
    ]);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: "CHAPTER_REVISION_CONFLICT",
        details: { chapterId: chapterId("batch-novel", 1) },
      },
    });
    const untouched = await env.DB.prepare(
      "SELECT content_hash FROM chapters WHERE id = ?",
    )
      .bind(chapterId("batch-novel", 2))
      .first<{ content_hash: string }>();
    expect(untouched?.content_hash).toBe("old-2");
  });

  it("跨文章 ID、目标 order 占用和批内重复 order 均整批 409", async () => {
    await seedNovel("owner-a", 2);
    await seedNovel("owner-b", 1);
    const cross = await batchRequest("owner-b", [
      {
        id: chapterId("owner-a", 0),
        title: "B 章",
        order: 0,
        content: contentFor("B"),
        hash: "b-0",
        baseRevision: 1,
      },
    ]);
    expect(cross.status).toBe(409);
    await expect(cross.json()).resolves.toMatchObject({
      error: {
        code: "CHAPTER_ID_CONFLICT",
        details: { chapterId: chapterId("owner-a", 0) },
      },
    });

    const occupied = await batchRequest("owner-a", [
      {
        id: chapterId("owner-a", 3),
        title: "新章",
        order: 1,
        content: contentFor("新"),
        hash: "n-1",
        baseRevision: 0,
      },
    ]);
    expect(occupied.status).toBe(409);
    await expect(occupied.json()).resolves.toMatchObject({
      error: {
        code: "CHAPTER_ORDER_CONFLICT",
        details: { chapterId: chapterId("owner-a", 3) },
      },
    });

    const duplicate = await batchRequest("owner-a", [
      { id: chapterId("owner-a", 3), title: "D0", order: 5, content: contentFor("D0"), hash: "d0", baseRevision: 0 },
      { id: chapterId("owner-a", 4), title: "D1", order: 5, content: contentFor("D1"), hash: "d1", baseRevision: 0 },
    ]);
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: {
        code: "CHAPTER_ORDER_CONFLICT",
        details: { chapterId: chapterId("owner-a", 4) },
      },
    });
  });

  it("换序暂存：staged 后幂等 unchanged、重试不重复递增、冲突 409", async () => {
    await seedNovel("reorder-novel", 3);
    const id0 = chapterId("reorder-novel", 0);
    const id1 = chapterId("reorder-novel", 1);
    const id2 = chapterId("reorder-novel", 2);
    const staged = await stageRequest("reorder-novel", [
      { id: id0, temporaryOrder: 4, baseRevision: 1 },
      { id: id1, temporaryOrder: 5, baseRevision: 1 },
      { id: id2, temporaryOrder: 6, baseRevision: 1 },
    ]);
    expect(staged.status, await staged.clone().text()).toBe(200);
    await expect(staged.json()).resolves.toEqual({
      chapters: [
        { id: id0, revision: 2, status: "staged" },
        { id: id1, revision: 2, status: "staged" },
        { id: id2, revision: 2, status: "staged" },
      ],
    });
    // 重试相同 baseRevision（响应丢失）：返回当前版本，不重复递增。
    const replayed = await stageRequest("reorder-novel", [
      { id: id0, temporaryOrder: 4, baseRevision: 1 },
    ]);
    await expect(replayed.json()).resolves.toEqual({
      chapters: [{ id: id0, revision: 2, status: "staged" }],
    });
    // 顺序已经等于临时顺序且版本匹配：unchanged。
    const unchanged = await stageRequest("reorder-novel", [
      { id: id0, temporaryOrder: 4, baseRevision: 2 },
    ]);
    await expect(unchanged.json()).resolves.toEqual({
      chapters: [{ id: id0, revision: 2, status: "unchanged" }],
    });
    // 临时顺序被批外章节占用：整批 409。
    const conflict = await stageRequest("reorder-novel", [
      { id: id0, temporaryOrder: 5, baseRevision: 2 },
    ]);
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: {
        code: "CHAPTER_ORDER_CONFLICT",
        details: { chapterId: id0 },
      },
    });
  });

  it("保留空行与标准节点转换（\r\n 空行不丢失）", async () => {
    await seedNovel("blank-lines", 1);
    const saved = await batchRequest("blank-lines", [
      {
        id: chapterId("blank-lines", 0),
        title: "空行章",
        order: 0,
        content: {
          type: "doc",
          content: [
            {
              type: "longTextBlock",
              attrs: { title: "空行章", text: "第一行\r\n\r\n第三行" },
            },
          ],
        },
        hash: "blank-hash",
        baseRevision: 1,
      },
    ]);
    expect(saved.status, await saved.clone().text()).toBe(200);
    const row = await env.DB.prepare(
      "SELECT content_json FROM chapters WHERE id = ?",
    )
      .bind(chapterId("blank-lines", 0))
      .first<{ content_json: string }>();
    const parsed = JSON.parse(row!.content_json) as {
      content: Array<{ type: string; content?: Array<{ text?: string }> }>;
    };
    expect(parsed.content.map((node) => node.type)).toEqual([
      "heading",
      "paragraph",
      "paragraph",
      "paragraph",
    ]);
    expect(JSON.stringify(parsed)).not.toContain("longTextBlock");
  });

  it("限制：超过 20 章 422、body 超过 5 MiB 413", async () => {
    await seedNovel("limits-novel", 1);
    const tooMany = await batchRequest(
      "limits-novel",
      Array.from({ length: 21 }, (_, index) => ({
        id: "limits-novel-extra-" + index,
        title: "X" + index,
        order: 10 + index,
        content: contentFor("X" + index),
        hash: "h-" + index,
        baseRevision: 0,
      })),
    );
    expect(tooMany.status).toBe(422);

    const tooLarge = await batchRequest("limits-novel", [
      {
        id: chapterId("limits-novel", 0),
        title: "超大章",
        order: 0,
        content: {
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "a".repeat(5.4 * 1024 * 1024) }],
            },
          ],
        },
        hash: "big",
        baseRevision: 1,
      },
    ]);
    expect(tooLarge.status).toBe(413);
    await expect(tooLarge.json()).resolves.toMatchObject({
      error: { code: "CHAPTER_BATCH_TOO_LARGE" },
    });
    // 超大正文不写入。
    const row = await env.DB.prepare(
      "SELECT content_hash FROM chapters WHERE id = ?",
    )
      .bind(chapterId("limits-novel", 0))
      .first<{ content_hash: string }>();
    expect(row?.content_hash).toBe("old-0");
  });

  it("实测：300 章更新只产生 15 个批量请求", async () => {
    await seedNovel("bench-novel", 300);
    const chapters = Array.from({ length: 300 }, (_, index) => ({
      id: chapterId("bench-novel", index),
      title: "章节 " + index,
      order: index,
      content: contentFor("新正文 " + index + "：这是批量实测用的普通小章节内容。"),
      hash: "bench-" + index,
      baseRevision: 1,
    }));
    const started = Date.now();
    let requests = 0;
    for (let offset = 0; offset < chapters.length; offset += 20) {
      requests += 1;
      const response = await batchRequest(
        "bench-novel",
        chapters.slice(offset, offset + 20),
      );
      expect(response.status, await response.clone().text()).toBe(200);
      const body = (await response.json()) as {
        chapters: Array<{ status: string; revision: number }>;
      };
      expect(body.chapters).toHaveLength(Math.min(20, chapters.length - offset));
      expect(
        body.chapters.every(
          (item) => item.status === "saved" && item.revision === 2,
        ),
      ).toBe(true);
    }
    const elapsed = Date.now() - started;
    console.log(
      "[batch benchmark] 300 chapters -> " +
        requests +
        " POST requests, " +
        elapsed +
        "ms total, ~" +
        Math.round((300 / elapsed) * 1000) +
        " chapters/s",
    );
    expect(requests).toBe(15);
    const finalState = await env.DB.prepare(
      "SELECT COUNT(*) AS count FROM chapters WHERE document_id = 'bench-novel' AND content_hash LIKE 'bench-%'",
    ).first<{ count: number }>();
    expect(finalState?.count).toBe(300);
  });
});
