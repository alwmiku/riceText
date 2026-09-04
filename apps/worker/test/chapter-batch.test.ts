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

async function manifestHash(chapters: Array<{ id: string; title: string; order: number; hash: string }>) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(chapters)));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** 章节 ID 可跨文章复用；order 从 0 连续。 */
function chapterId(_novelId: string, index: number): string {
  return "chapter-" + index;
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
  it("删除同 ID 章节只影响目标文章及其校订关联", async () => {
    await seedNovel("owner-a", 1);
    await seedNovel("owner-b", 1);
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO suggestions(id, document_id, chapter_id, chapter_title, line_no, line_text, from_text, to_text, reason, status, author_id, created_at) " +
          "VALUES (?, ?, ?, '', 0, '', '', '', '', 'pending', 'author', ?)",
      ).bind("suggestion-a", "owner-a", chapterId("owner-a", 0), now),
      env.DB.prepare(
        "INSERT INTO suggestions(id, document_id, chapter_id, chapter_title, line_no, line_text, from_text, to_text, reason, status, author_id, created_at) " +
          "VALUES (?, ?, ?, '', 0, '', '', '', '', 'pending', 'author', ?)",
      ).bind("suggestion-b", "owner-b", chapterId("owner-b", 0), now),
    ]);

    const response = await exports.default.fetch(
      new Request(
        "http://example.com/api/documents/owner-a/chapters/" +
          chapterId("owner-a", 0),
        { method: "DELETE", headers: { "x-user-id": "author" } },
      ),
    );
    expect(response.status).toBe(200);
    const chapters = await env.DB.prepare(
      "SELECT document_id FROM chapters WHERE id = ? ORDER BY document_id",
    )
      .bind(chapterId("owner-a", 0))
      .all<{ document_id: string }>();
    expect(chapters.results).toEqual([{ document_id: "owner-b" }]);
    const suggestions = await env.DB.prepare(
      "SELECT id, chapter_id FROM suggestions WHERE id IN (?, ?) ORDER BY id",
    )
      .bind("suggestion-a", "suggestion-b")
      .all<{ id: string; chapter_id: string | null }>();
    expect(suggestions.results).toEqual([
      { id: "suggestion-a", chapter_id: null },
      { id: "suggestion-b", chapter_id: chapterId("owner-b", 0) },
    ]);
  });

  it("删除中间章节后压紧后续顺序", async () => {
    await seedNovel("owner-a", 3);
    const response = await exports.default.fetch(
      new Request(
        "http://example.com/api/documents/owner-a/chapters/" +
          chapterId("owner-a", 1),
        { method: "DELETE", headers: { "x-user-id": "author" } },
      ),
    );
    expect(response.status).toBe(200);
    const chapters = await env.DB.prepare(
      "SELECT id, sort_order, revision FROM chapters " +
        "WHERE document_id = ? ORDER BY sort_order",
    )
      .bind("owner-a")
      .all<{ id: string; sort_order: number; revision: number }>();
    expect(chapters.results).toEqual([
      { id: chapterId("owner-a", 0), sort_order: 0, revision: 1 },
      { id: chapterId("owner-a", 2), sort_order: 1, revision: 2 },
    ]);
  });

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

  it("跨文章复用 ID；批内重复或目标 order 占用都 fail-closed", async () => {
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
    expect(cross.status).toBe(200);
    await expect(cross.json()).resolves.toMatchObject({
      chapters: [{ id: chapterId("owner-a", 0), status: "saved" }],
    });
    const ownerA = await env.DB.prepare(
      "SELECT content_hash FROM chapters WHERE document_id = ? AND id = ?",
    )
      .bind("owner-a", chapterId("owner-a", 0))
      .first<{ content_hash: string }>();
    expect(ownerA?.content_hash).toBe("old-0");

    // 旧直写接口不得自动搬移线上章节。
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
    const after = await env.DB.prepare(
      "SELECT id, sort_order, content_hash FROM chapters WHERE document_id = 'owner-a' ORDER BY sort_order",
    ).all<{ id: string; sort_order: number; content_hash: string }>();
    expect(after.results.map((row) => [row.id, row.sort_order])).toEqual([
      [chapterId("owner-a", 0), 0],
      [chapterId("owner-a", 1), 1],
    ]);
    expect(after.results[1]?.content_hash).toBe("old-1");

    // 批内重复目标顺序仍是整批 409（用全新 id，避免与上一段已写行冲突）。
    const duplicate = await batchRequest("owner-a", [
      { id: chapterId("owner-a", 8), title: "D0", order: 5, content: contentFor("D0"), hash: "d0", baseRevision: 0 },
      { id: chapterId("owner-a", 9), title: "D1", order: 5, content: contentFor("D1"), hash: "d1", baseRevision: 0 },
    ]);
    expect(duplicate.status).toBe(409);
    await expect(duplicate.json()).resolves.toMatchObject({
      error: {
        code: "CHAPTER_ORDER_CONFLICT",
        details: { chapterId: chapterId("owner-a", 9) },
      },
    });
  });

  it("上传批次可乱序到达，完整验收前不改变线上目录", async () => {
    await seedNovel("atomic-novel", 1);
    const manifest = [
      { id: "new-a", title: "A", volumeTitle: "第一卷", order: 0, hash: "ha" },
      { id: "new-b", title: "B", volumeTitle: "第一卷", order: 1, hash: "hb" },
      { id: "new-c", title: "C", volumeTitle: "第二卷", order: 2, hash: "hc" },
    ];
    const create = await exports.default.fetch(new Request(
      "http://example.com/api/forum/novels/atomic-novel/chapter-uploads",
      { method: "POST", headers: { "content-type": "application/json", "x-user-id": "author" }, body: JSON.stringify({ manifestHash: await manifestHash(manifest), totalChapters: 3 }) },
    ));
    expect(create.status, await create.clone().text()).toBe(200);
    const uploadId = ((await create.json()) as { uploadId: string }).uploadId;
    const stage = (items: typeof manifest) => exports.default.fetch(new Request(
      `http://example.com/api/forum/novels/atomic-novel/chapter-uploads/${uploadId}/batch`,
      { method: "PUT", headers: { "content-type": "application/json", "x-user-id": "author" }, body: JSON.stringify({ chapters: items.map((item) => ({ ...item, content: contentFor(item.title), baseRevision: 0 })) }) },
    ));
    expect((await stage([manifest[2]!])).status).toBe(200);
    const incomplete = await exports.default.fetch(new Request(
      `http://example.com/api/forum/novels/atomic-novel/chapter-uploads/${uploadId}/complete`,
      { method: "POST", headers: { "x-user-id": "author" } },
    ));
    expect(incomplete.status).toBe(409);
    const before = await env.DB.prepare("SELECT id,sort_order FROM chapters WHERE document_id=? ORDER BY sort_order").bind("atomic-novel").all();
    expect(before.results).toEqual([{ id: "chapter-0", sort_order: 0 }]);
    expect((await stage([manifest[0]!, manifest[1]!])).status).toBe(200);
    const complete = await exports.default.fetch(new Request(
      `http://example.com/api/forum/novels/atomic-novel/chapter-uploads/${uploadId}/complete`,
      { method: "POST", headers: { "x-user-id": "author" } },
    ));
    expect(complete.status, await complete.clone().text()).toBe(200);
    const after = await env.DB.prepare("SELECT id,volume_title,sort_order FROM chapters WHERE document_id=? ORDER BY sort_order").bind("atomic-novel").all();
    expect(after.results).toEqual([
      { id: "new-a", volume_title: "第一卷", sort_order: 0 },
      { id: "new-b", volume_title: "第一卷", sort_order: 1 },
      { id: "new-c", volume_title: "第二卷", sort_order: 2 },
    ]);
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
