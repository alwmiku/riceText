// 所有语句均在应用生产迁移的 Miniflare D1 上执行。
// 包装器仅在 db.batch 执行前安排竞争请求。
import { env } from "cloudflare:workers";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { D1ChapterRepository } from "../src/repositories/chapter-repository";

const content = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] };
const manifest = [
  { id: "a", title: "新 A", volumeTitle: "卷", order: 0, hash: "new-a" },
  { id: "new", title: "新章节", volumeTitle: "卷", order: 1, hash: "new" },
];
async function digest(value: unknown) {
  return Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
function beforeBatch(callback: () => Promise<void>) {
  return new D1ChapterRepository(new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch") return async (statements: D1PreparedStatement[]) => {
        await callback();
        return target.batch(statements);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }));
}

describe("D1 章节发布保护", () => {
  let documentId: string;
  let repository: D1ChapterRepository;
  let uploadId: string;
  let hash: string;
  const state = async () => (await env.DB.prepare("SELECT id,title,sort_order,revision,content_hash FROM chapters WHERE document_id=? ORDER BY sort_order").bind(documentId).all()).results;
  beforeEach(async () => {
    documentId = "publication-" + crypto.randomUUID();
    await env.DB.prepare("INSERT OR IGNORE INTO users(id,name,role,is_friend,bio,created_at,updated_at) VALUES('publication-author','作者','author',0,'','now','now')").run();
    await env.DB.prepare("INSERT INTO documents(id,title,schema_version,current_revision,created_by,created_at,updated_at) VALUES(?,'文章',1,0,'publication-author','now','now')").bind(documentId).run();
    repository = new D1ChapterRepository(env.DB);
    await repository.save(documentId, "a", { title: "旧 A", order: 0, content, hash: "old-a", baseRevision: 0 });
    await repository.save(documentId, "removed", { title: "将被移除", order: 1, content, hash: "old-removed", baseRevision: 0 });
    hash = await digest(manifest);
    uploadId = (await repository.createUpload(documentId, hash, 2)).uploadId;
    await repository.stageUploadBatch(documentId, uploadId, manifest.map((item) => ({ ...item, content, baseRevision: item.id === "a" ? 1 : 0 })));
  });
  afterEach(async () => {
    await env.DB.prepare("DELETE FROM chapters WHERE document_id=?").bind(documentId).run();
    await env.DB.prepare("DELETE FROM documents WHERE id=?").bind(documentId).run();
  });

  it.each(["a", "removed", "added"])("保留应用层预检查后对 %s 的并发保存结果", async (id) => {
    let before: unknown;
    const racing = beforeBatch(async () => {
      await repository.save(documentId, id, { title: "并发保存", order: id === "a" ? 0 : id === "removed" ? 1 : 2, content, hash: "concurrent", baseRevision: id === "added" ? 0 : 1 });
      before = await state();
    });
    await expect(racing.completeUpload(documentId, uploadId)).rejects.toMatchObject({ code: "CHAPTER_REVISION_CONFLICT" });
    expect(await state()).toEqual(before);
    expect(await env.DB.prepare("SELECT status,publish_token FROM chapter_uploads WHERE document_id=? AND id=?").bind(documentId, uploadId).first()).toEqual({ status: "uploading", publish_token: null });
    const fresh = await repository.createUpload(documentId, hash, 2);
    expect(fresh.uploadId).not.toBe(uploadId);
    expect(fresh.staged).toEqual([]);
  });

  it("拒绝两次完整发布中竞争失败的一次，且保留成功发布结果", async () => {
    const secondManifest = manifest.map((item) => ({ ...item, title: item.title + "另一套" }));
    const second = await repository.createUpload(documentId, await digest(secondManifest), 2);
    await repository.stageUploadBatch(documentId, second.uploadId, secondManifest.map((item) => ({ ...item, content, baseRevision: item.id === "a" ? 1 : 0 })));
    let winner: unknown;
    const racing = beforeBatch(async () => {
      winner = await repository.completeUpload(documentId, second.uploadId);
    });
    await expect(racing.completeUpload(documentId, uploadId)).rejects.toMatchObject({ code: "CHAPTER_REVISION_CONFLICT" });
    expect(await repository.completeUpload(documentId, second.uploadId)).toEqual(winner);
    expect(await state()).toMatchObject([{ id: "a", title: "新 A另一套", revision: 2 }, { id: "new", revision: 1 }]);
  });

  it("阻止持有过期令牌的请求发布，且失败时不清除新请求的令牌", async () => {
    const before = await state();
    const racing = beforeBatch(async () => {
      await expect(repository.createUpload(documentId, hash, 2)).rejects.toMatchObject({ code: "CHAPTER_UPLOAD_NOT_ACTIVE" });
      await expect(repository.completeUpload(documentId, uploadId)).rejects.toMatchObject({ code: "CHAPTER_UPLOAD_NOT_ACTIVE" });
      await env.DB.prepare("UPDATE chapter_uploads SET publish_expires_at='2000-01-01T00:00:00.000Z' WHERE document_id=? AND id=?").bind(documentId, uploadId).run();
      expect(await repository.createUpload(documentId, hash, 2)).toMatchObject({ uploadId, staged: ["a", "new"] });
      await env.DB.prepare("UPDATE chapter_uploads SET publish_token='new-owner',publish_expires_at=? WHERE document_id=? AND id=?").bind(new Date(Date.now() + 60_000).toISOString(), documentId, uploadId).run();
    });
    await expect(racing.completeUpload(documentId, uploadId)).rejects.toMatchObject({ code: "CHAPTER_UPLOAD_NOT_ACTIVE" });
    expect(await state()).toEqual(before);
    expect(await env.DB.prepare("SELECT publish_token FROM chapter_uploads WHERE document_id=? AND id=?").bind(documentId, uploadId).first()).toEqual({ publish_token: "new-owner" });
    await env.DB.prepare("UPDATE chapter_uploads SET publish_expires_at='2000-01-01T00:00:00.000Z' WHERE document_id=? AND id=?").bind(documentId, uploadId).run();
    const completed = await repository.completeUpload(documentId, uploadId);
    expect(await repository.completeUpload(documentId, uploadId)).toEqual(completed);
  });

  it("后期失败时回滚整个批次，并允许暂停、恢复及重复完成", async () => {
    const before = await state();
    await env.DB.prepare("UPDATE chapter_uploads SET status='aborted' WHERE document_id=? AND id=?").bind(documentId, uploadId).run();
    await expect(repository.completeUpload(documentId, uploadId)).rejects.toMatchObject({ code: "CHAPTER_UPLOAD_NOT_ACTIVE" });
    expect(await repository.createUpload(documentId, hash, 2)).toMatchObject({ uploadId, staged: ["a", "new"] });
    await env.DB.exec("CREATE TRIGGER fail_chapter_publication BEFORE UPDATE OF status ON chapter_uploads WHEN NEW.status='published' BEGIN SELECT RAISE(ABORT,'injected publication failure'); END;");
    try {
      await expect(repository.completeUpload(documentId, uploadId)).rejects.toMatchObject({ code: "CHAPTER_UPLOAD_PUBLISH_CONFLICT" });
      expect(await state()).toEqual(before);
      expect(await env.DB.prepare("SELECT COUNT(*) count FROM chapter_publish_guards").first()).toEqual({ count: 0 });
      expect(await env.DB.prepare("SELECT status,publish_token FROM chapter_uploads WHERE document_id=? AND id=?").bind(documentId, uploadId).first()).toEqual({ status: "uploading", publish_token: null });
    } finally {
      await env.DB.exec("DROP TRIGGER fail_chapter_publication;");
    }
    const completed = await repository.completeUpload(documentId, uploadId);
    expect(await repository.completeUpload(documentId, uploadId)).toEqual(completed);
    expect(await state()).toMatchObject([{ id: "a", sort_order: 0, revision: 2 }, { id: "new", sort_order: 1, revision: 1 }]);
  });

  it("预检查与批次执行之间会话被发布请求占用时拒绝暂存", async () => {
    const racing = beforeBatch(async () => {
      await env.DB.prepare("UPDATE chapter_uploads SET publish_token='publisher',publish_expires_at=? WHERE document_id=? AND id=?").bind(new Date(Date.now() + 60_000).toISOString(), documentId, uploadId).run();
    });
    await expect(racing.stageUploadBatch(documentId, uploadId, [{ ...manifest[0]!, title: "篡改", content, baseRevision: 1 }])).rejects.toMatchObject({ status: 409 });
    expect(await env.DB.prepare("SELECT title FROM chapter_upload_items WHERE document_id=? AND upload_id=? AND chapter_id='a'").bind(documentId, uploadId).first()).toEqual({ title: "新 A" });
    await env.DB.prepare("UPDATE chapter_uploads SET publish_token=NULL,publish_expires_at=NULL WHERE document_id=? AND id=?").bind(documentId, uploadId).run();
  });
});
