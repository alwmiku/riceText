// 使用两个真实的 SQLite 连接；钩子只控制并发竞态的执行顺序。
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDatabase } from "../db.js";
import { ChapterService } from "./chapter-service.js";

const content = { type: "doc" as const, content: [{ type: "paragraph", content: [{ type: "text", text: "正文" }] }] };
const manifest = [
  { id: "a", title: "新 A", volumeTitle: "卷", order: 0, hash: "new-a" },
  { id: "new", title: "新章节", volumeTitle: "卷", order: 1, hash: "new" },
];
const hash = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");

it("升级真实的旧版 D1 schema，且不信任未记录的上传基线", () => {
  const legacy = new DatabaseSync(":memory:");
  try {
    legacy.exec("PRAGMA foreign_keys=ON");
    // 根目录的 Vitest 测试套件从工作区运行；jsdom 中的 import.meta.url 使用 HTTP。
    const migrationDirectory = resolve("apps/worker/migrations");
    for (const file of readdirSync(migrationDirectory).filter((name) => name.endsWith(".sql") && name < "0011").sort()) {
      legacy.exec(readFileSync(join(migrationDirectory, file), "utf8"));
    }
    legacy.exec("INSERT INTO users(id,name,role,is_friend,bio,created_at,updated_at) VALUES('author','作者','author',0,'','now','now')");
    legacy.exec("INSERT INTO documents(id,title,schema_version,current_revision,created_by,created_at,updated_at) VALUES('doc','文章',1,0,'author','now','now')");
    legacy.exec("INSERT INTO chapter_uploads(document_id,id,manifest_hash,total_chapters,status,created_at) VALUES('doc','paused','hash',1,'aborted','now'),('doc','done','hash',1,'published','now')");
    legacy.exec("INSERT INTO chapter_upload_items(document_id,upload_id,chapter_id,title,sort_order,content_hash,base_revision,revision,content_json) VALUES('doc','paused','a','A',0,'hash',0,1,'{}')");
    legacy.exec(readFileSync(join(migrationDirectory, "0011_chapter_publish_guards.sql"), "utf8"));
    expect(legacy.prepare("SELECT id,status,base_generation,publish_token FROM chapter_uploads ORDER BY id").all()).toEqual([
      { id: "done", status: "published", base_generation: 0, publish_token: null },
      { id: "paused", status: "aborted", base_generation: -1, publish_token: null },
    ]);
    expect(legacy.prepare("SELECT chapter_id FROM chapter_upload_items").all()).toEqual([{ chapter_id: "a" }]);
    legacy.exec("UPDATE chapter_uploads SET status='uploading',publish_token='legacy',publish_expires_at='2999-01-01' WHERE id='paused'");
    expect(() => legacy.exec("INSERT INTO chapter_publish_guards VALUES('doc','paused','legacy')")).toThrow(/CHAPTER_REVISION_CONFLICT/);
    expect(legacy.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  } finally { legacy.close(); }
});

describe("使用真实 SQLite 连接的章节发布", () => {
  let directory: string;
  let db: DatabaseSync;
  let other: DatabaseSync;
  let service: ChapterService;
  let writer: ChapterService;
  let uploadId: string;
  const state = (connection: DatabaseSync) => connection.prepare("SELECT id,title,sort_order,revision,content_hash FROM chapters WHERE document_id='doc' ORDER BY sort_order").all();
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "ricetext-chapter-publication-"));
    db = createDatabase({ path: join(directory, "test.sqlite"), seed: false });
    db.prepare("INSERT INTO users(id,name,role,is_friend,bio) VALUES('author','作者','author',0,'')").run();
    db.prepare("INSERT INTO documents(id,title,schema_version,current_revision,created_by,created_at,updated_at) VALUES('doc','文章',1,0,'author','now','now')").run();
    service = new ChapterService(db);
    service.saveChapter("doc", "a", { title: "旧 A", order: 0, content, hash: "old-a", baseRevision: 0 });
    service.saveChapter("doc", "removed", { title: "将被移除", order: 1, content, hash: "old-removed", baseRevision: 0 });
    other = new DatabaseSync(join(directory, "test.sqlite"));
    other.exec("PRAGMA busy_timeout=0");
    writer = new ChapterService(other);
    uploadId = service.createUpload("doc", hash, 2).uploadId;
    service.stageUploadBatch("doc", uploadId, manifest.map((item) => ({ ...item, content, baseRevision: item.id === "a" ? 1 : 0 })));
  });
  afterEach(() => { vi.restoreAllMocks(); other.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });

  it("获取 BEGIN IMMEDIATE 写锁后重新检查修订，保留原竞态窗口内的保存结果", () => {
    const exec = db.exec.bind(db);
    let raced = false;
    vi.spyOn(db, "exec").mockImplementation((sql) => {
      if (sql === "BEGIN IMMEDIATE" && !raced) {
        raced = true;
        writer.saveChapter("doc", "a", { title: "并发保存", order: 0, content, hash: "concurrent", baseRevision: 1 });
      }
      return exec(sql);
    });
    expect(() => service.completeUpload("doc", uploadId)).toThrowError(expect.objectContaining({ code: "CHAPTER_REVISION_CONFLICT" }));
    expect(state(other)).toMatchObject([{ id: "a", revision: 2, content_hash: "concurrent" }, { id: "removed", sort_order: 1 }]);
    expect(db.prepare("SELECT status,publish_token FROM chapter_uploads WHERE id=?").get(uploadId)).toEqual({ status: "uploading", publish_token: null });
    const fresh = service.createUpload("doc", hash, 2);
    expect(fresh.uploadId).not.toBe(uploadId);
    expect(fresh.staged).toEqual([]);
  });

  it.each(["removed", "added"])("保护清单之外并发修改的 %s 章节", (id) => {
    writer.saveChapter("doc", id, { title: "并发", order: id === "removed" ? 1 : 2, content, hash: "concurrent", baseRevision: id === "removed" ? 1 : 0 });
    const before = state(other);
    expect(() => service.completeUpload("doc", uploadId)).toThrowError(expect.objectContaining({ code: "CHAPTER_REVISION_CONFLICT" }));
    expect(state(other)).toEqual(before);
  });

  it("提交前始终可见完整旧章节集，后期失败时回滚", () => {
    const before = state(other);
    const prepare = db.prepare.bind(db);
    let observed = false;
    vi.spyOn(db, "prepare").mockImplementation((sql) => {
      if (sql.startsWith("DELETE FROM chapters WHERE document_id")) {
        observed = true;
        expect(state(other)).toEqual(before);
        expect(() => writer.saveChapter("doc", "a", { title: "blocked", order: 0, content, hash: "blocked", baseRevision: 1 })).toThrow(/locked/);
      }
      return prepare(sql);
    });
    db.exec("CREATE TRIGGER fail_publication BEFORE UPDATE OF status ON chapter_uploads WHEN NEW.status='published' BEGIN SELECT RAISE(ABORT,'injected failure'); END");
    expect(() => service.completeUpload("doc", uploadId)).toThrow(/injected failure/);
    expect(observed).toBe(true);
    expect(state(other)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) count FROM chapter_publish_guards").get()).toEqual({ count: 0 });
    db.exec("DROP TRIGGER fail_publication");
    const result = service.completeUpload("doc", uploadId);
    expect(service.completeUpload("doc", uploadId)).toEqual(result);
    expect(state(other)).toMatchObject([{ id: "a", revision: 2, sort_order: 0 }, { id: "new", revision: 1, sort_order: 1 }]);
  });

  it("恢复已暂停或已过期的会话，且不抢占正在进行的发布", () => {
    db.prepare("UPDATE chapter_uploads SET status='aborted' WHERE id=?").run(uploadId);
    expect(() => service.completeUpload("doc", uploadId)).toThrowError(expect.objectContaining({ code: "CHAPTER_UPLOAD_NOT_ACTIVE" }));
    expect(service.createUpload("doc", hash, 2)).toMatchObject({ uploadId, staged: ["a", "new"] });
    db.prepare("UPDATE chapter_uploads SET publish_token='old',publish_expires_at=? WHERE id=?").run(new Date(Date.now() + 60_000).toISOString(), uploadId);
    expect(() => service.createUpload("doc", hash, 2)).toThrowError(expect.objectContaining({ code: "CHAPTER_UPLOAD_NOT_ACTIVE" }));
    expect(() => service.completeUpload("doc", uploadId)).toThrowError(expect.objectContaining({ code: "CHAPTER_UPLOAD_NOT_ACTIVE" }));
    expect(() => service.stageUploadBatch("doc", uploadId, [{ ...manifest[0]!, content, baseRevision: 1 }])).toThrowError(expect.objectContaining({ code: "CHAPTER_UPLOAD_NOT_ACTIVE" }));
    db.prepare("UPDATE chapter_uploads SET publish_expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(uploadId);
    expect(service.createUpload("doc", hash, 2)).toMatchObject({ uploadId, staged: ["a", "new"] });
    const result = service.completeUpload("doc", uploadId);
    expect(service.completeUpload("doc", uploadId)).toEqual(result);
  });
});
