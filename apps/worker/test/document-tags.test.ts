// 文章标签的 Worker 行为：来源解析、上限、软隐藏与「不产生正文修订」。
import { env, exports } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

const now = "2026-09-17T08:00:00.000Z";
const content = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { level: 1, chapterStart: true, chapterId: "chapter-0" },
      content: [{ type: "text", text: "标签测试" }],
    },
    { type: "paragraph", content: [{ type: "text", text: "正文" }] },
  ],
};

type DocumentTagBody = {
  items: Array<{ slug: string; label: string; source: "server" | "author"; tagId: string | null }>;
};

function request(path: string, init: { method?: string; userId?: string; body?: unknown } = {}) {
  return exports.default.fetch(
    new Request("http://example.com" + path, {
      method: init.method ?? "GET",
      headers: {
        ...(init.body === undefined ? {} : { "content-type": "application/json" }),
        "x-user-id": init.userId ?? "author",
      },
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
}

async function putTags(labels: string[], userId = "author") {
  return request("/api/documents/demo-post/tags", {
    method: "PUT",
    userId,
    body: { items: labels.map((label) => ({ label })) },
  });
}

beforeEach(async () => {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM document_tags"),
    env.DB.prepare("DELETE FROM tags"),
    env.DB.prepare("DELETE FROM chapter_write_guards"),
    env.DB.prepare("DELETE FROM chapter_revisions"),
    env.DB.prepare("DELETE FROM document_mutations"),
    env.DB.prepare("DELETE FROM chapters"),
    env.DB.prepare("DELETE FROM document_revisions"),
    env.DB.prepare("DELETE FROM document_acl"),
    env.DB.prepare("DELETE FROM documents"),
    env.DB.prepare("DELETE FROM users"),
  ]);
  await env.DB.batch([
    env.DB.prepare(
      "INSERT OR IGNORE INTO users(id, name, role, is_friend, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("author", "林见", "author", 1, "作者", now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO users(id, name, role, is_friend, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("reader", "小满", "reader", 1, "读者", now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO users(id, name, role, is_friend, bio, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("moderator", "版务七号", "moderator", 0, "版主", now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO documents(id, title, schema_version, current_revision, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind("demo-post", "标签测试", 1, 1, "author", now, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO document_revisions(document_id, revision, schema_version, content_json, steps_json, author_id, operation, target_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind("demo-post", 1, 1, JSON.stringify(content), null, "author", "seed", null, now),
    env.DB.prepare(
      "INSERT OR IGNORE INTO chapters(id, title, sort_order, document_id, revision, content_json, content_hash, updated_at, hidden) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind("chapter-0", "标签测试", 0, "demo-post", 1, JSON.stringify(content), "hash", now, 0),
    env.DB.prepare(
      "INSERT OR IGNORE INTO chapter_revisions(document_id, chapter_id, chapter_revision, document_revision, operation, schema_version, author_id, created_at) VALUES (?, ?, 1, 1, 'seed', 1, ?, ?)",
    ).bind("demo-post", "chapter-0", "author", now),
  ]);
});

describe("文章标签", () => {
  it("作者手打的标签只属于这篇文章，不写进站点字典", async () => {
    const saved = await putTags(["#慢热"]);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({
      items: [{ slug: "慢热", label: "慢热", source: "author", tagId: null }],
    });
    const dictionary = await env.DB.prepare("SELECT COUNT(*) AS total FROM tags").first<{
      total: number;
    }>();
    expect(dictionary?.total).toBe(0);
  });

  it("命中站点标签时归为服务器标签，且不产生任何修订", async () => {
    const created = await request("/api/forum/tags", {
      method: "POST",
      userId: "moderator",
      body: { label: "连载中", description: "章节仍在更新" },
    });
    expect(created.status).toBe(201);
    const tag = (await created.json()) as { id: string; slug: string; label: string };

    const saved = await putTags(["连载中"]);
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({
      items: [{ slug: tag.slug, label: "连载中", source: "server", tagId: tag.id }],
    });

    // 标签是元数据：不改 current_revision，也不写整篇/章节版本账本。
    const document = await env.DB.prepare(
      "SELECT current_revision FROM documents WHERE id = 'demo-post'",
    ).first<{ current_revision: number }>();
    expect(document?.current_revision).toBe(1);
    const revisions = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM document_revisions",
    ).first<{ total: number }>();
    expect(revisions?.total).toBe(1);
    const ledger = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM chapter_revisions",
    ).first<{ total: number }>();
    expect(ledger?.total).toBe(1);
  });

  it("全量替换按 slug 去重并保留顺序", async () => {
    const saved = await putTags(["#奇幻", " 奇幻 ", "慢热"]);
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as DocumentTagBody;
    expect(body.items.map((item) => item.label)).toEqual(["奇幻", "慢热"]);
    expect(body.items.map((item) => item.source)).toEqual(["author", "author"]);

    const replaced = await putTags(["慢热"]);
    const after = (await replaced.json()) as DocumentTagBody;
    expect(after.items.map((item) => item.label)).toEqual(["慢热"]);
  });

  it("超过 5 个标签返回 422 且保留原标签", async () => {
    await putTags(["甲", "乙"]);
    const overflow = await putTags(["甲", "乙", "丙", "丁", "戊", "己"]);
    expect(overflow.status).toBe(422);
    await expect(overflow.json()).resolves.toMatchObject({
      error: { code: "TAG_LIMIT_EXCEEDED" },
    });
    const current = await request("/api/documents/demo-post/tags");
    const body = (await current.json()) as DocumentTagBody;
    expect(body.items.map((item) => item.label)).toEqual(["甲", "乙"]);
  });

  it("非法标签文本返回 422", async () => {
    for (const label of ["###", "   ", "x".repeat(40)]) {
      const rejected = await putTags([label]);
      expect(rejected.status).toBe(422);
      await expect(rejected.json()).resolves.toMatchObject({
        error: { code: "TAG_LABEL_INVALID" },
      });
    }
  });

  it("读者不能改标签，缺失文章返回 404", async () => {
    const forbidden = await putTags(["慢热"], "reader");
    expect(forbidden.status).toBe(403);

    const missing = await request("/api/documents/not-here/tags", {
      method: "PUT",
      userId: "moderator",
      body: { items: [{ label: "慢热" }] },
    });
    expect(missing.status).toBe(404);
    await expect(missing.json()).resolves.toMatchObject({
      error: { code: "DOCUMENT_NOT_FOUND" },
    });
  });

  it("只有版主能维护站点字典，且 slug 冲突返回 409", async () => {
    const denied = await request("/api/forum/tags", {
      method: "POST",
      userId: "author",
      body: { label: "版务" },
    });
    expect(denied.status).toBe(403);

    const created = await request("/api/forum/tags", {
      method: "POST",
      userId: "moderator",
      body: { label: "版务" },
    });
    expect(created.status).toBe(201);
    const tag = (await created.json()) as { id: string; slug: string; hidden: boolean };
    expect(tag.hidden).toBe(false);

    const duplicated = await request("/api/forum/tags", {
      method: "POST",
      userId: "moderator",
      body: { label: "#版务" },
    });
    expect(duplicated.status).toBe(409);
    await expect(duplicated.json()).resolves.toMatchObject({
      error: { code: "TAG_SLUG_CONFLICT" },
    });
  });

  it("字典改名同步文章展示文本，隐藏后读者看不到而作者仍看得见", async () => {
    const created = await request("/api/forum/tags", {
      method: "POST",
      userId: "moderator",
      body: { label: "连载中" },
    });
    const tag = (await created.json()) as { id: string };
    await putTags(["连载中"]);

    const renamed = await request("/api/forum/tags/" + tag.id, {
      method: "PATCH",
      userId: "moderator",
      body: { label: "连载中 · 更新" },
    });
    expect(renamed.status).toBe(200);
    const readerView = (await (await request("/api/documents/demo-post/tags")).json()) as DocumentTagBody;
    expect(readerView.items.map((item) => item.label)).toEqual(["连载中 · 更新"]);

    const hidden = await request("/api/forum/tags/" + tag.id, {
      method: "PATCH",
      userId: "moderator",
      body: { hidden: true },
    });
    expect(hidden.status).toBe(200);
    const afterHide = (await (
      await request("/api/documents/demo-post/tags", { userId: "reader" })
    ).json()) as DocumentTagBody;
    expect(afterHide.items).toEqual([]);
    const authorView = (await (
      await request("/api/documents/demo-post/tags", { userId: "author" })
    ).json()) as DocumentTagBody;
    expect(authorView.items.map((item) => item.label)).toEqual(["连载中 · 更新"]);

    // 隐藏条目不再出现在候选列表里。
    const candidates = (await (
      await request("/api/forum/tags", { userId: "author" })
    ).json()) as { items: Array<{ id: string }> };
    expect(candidates.items.map((item) => item.id)).not.toContain(tag.id);
  });
});
