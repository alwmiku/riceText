// 迁移集成测试会把生成 SQL 真正导入 D1 同构 schema，防止只验证文本格式。
import { DatabaseSync } from "node:sqlite";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { exportSqliteToCloudflare } from "@ricetext/cloudflare-migration";
import { createDatabase } from "./db.js";

describe("Cloudflare data export", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ricetext-cloudflare-export-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("exports old SQLite data into the squashed D1 schema and R2 manifest", async () => {
    const sourcePath = join(directory, "source.sqlite");
    const uploads = join(directory, "uploads");
    const output = join(directory, "export");
    await mkdir(uploads, { recursive: true });
    const source = createDatabase({ path: sourcePath });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    await writeFile(join(uploads, "legacy.png"), png);
    source.prepare(
      "INSERT INTO assets(id, original_name, stored_name, mime_type, byte_size, created_by, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .run(
        "asset-export-test",
        "测试图片.png",
        "legacy.png",
        "image/png",
        png.byteLength,
        "reader",
        "2026-08-20T08:00:00.000Z",
      );
    source.prepare(
      "UPDATE suggestions SET status = 'approved', reviewer_id = 'author', reviewed_at = ? " +
        "WHERE id = 'suggestion-1'",
    ).run("2026-08-21T08:00:00.000Z");
    source.prepare(
      "UPDATE attachments SET download_url = '/api/assets/asset-export-test' " +
        "WHERE id = 'attachment-sample'",
    ).run();
    source.prepare(
      "INSERT OR REPLACE INTO document_acl(document_id, user_id, permission, created_at) " +
        "VALUES ('demo-post', 'reader', 'edit', ?)",
    ).run("2026-08-21T08:00:00.000Z");
    const sourceWallets = source
      .prepare("SELECT user_id, balance FROM wallets ORDER BY user_id")
      .all() as Array<{ user_id: string; balance: number }>;
    const sourceDocuments = (
      source.prepare("SELECT COUNT(*) AS count FROM documents").get() as { count: number }
    ).count;
    source.close();

    const result = await exportSqliteToCloudflare({
      databasePath: sourcePath,
      uploadsDirectory: uploads,
      outputDirectory: output,
      identityMappings: [
        { issuer: "https://id.example.com", subject: "author-sub", userId: "author" },
        { issuer: "https://id.example.com", subject: "moderator-sub", userId: "moderator" },
        { issuer: "https://id.example.com", subject: "reader-editor-sub", userId: "reader" },
      ],
      exportedAt: "2026-09-02T00:00:00.000Z",
    });
    const manifest = JSON.parse(await readFile(result.manifestPath, "utf8")) as {
      items: Array<{ assetId: string; objectKey: string; checksum: string; state: string }>;
    };
    expect(manifest.items).toEqual([
      expect.objectContaining({
        assetId: "asset-export-test",
        objectKey: "legacy/legacy.png",
        checksum: "4c4b6a3be1314ab86138bef4314dde022e600960d8689a2c8f8631802d20dab6",
        state: "ready",
      }),
    ]);
    const report = JSON.parse(await readFile(result.reportPath, "utf8")) as {
      counts: Record<string, number>;
      r2: { ready: number; missing: string[]; bytes: number };
    };
    expect(report.counts.documents).toBe(sourceDocuments);
    expect(report.r2).toEqual({ ready: 1, missing: [], bytes: png.byteLength });

    const targetPath = join(directory, "target.sqlite");
    const target = new DatabaseSync(targetPath);
    const migrationsDirectory = resolve("apps/worker/migrations");
    for (const name of (await readdir(migrationsDirectory)).filter((item) => item.endsWith(".sql")).sort()) {
      target.exec(await readFile(join(migrationsDirectory, name), "utf8"));
    }
    const importSql = await readFile(result.sqlPath, "utf8");
    expect(importSql).not.toContain("BEGIN TRANSACTION");
    expect(importSql).not.toContain("COMMIT;");
    // 远端 D1 会误拆 trigger 内部的 CASE ... END，导入 SQL 也必须使用 WHERE 形式。
    expect(importSql).not.toContain("SELECT CASE");
    target.exec(importSql);

    const identity = target.prepare(
      "SELECT user_id FROM auth_identities WHERE issuer = ? AND subject = ?",
    ).get("https://id.example.com", "author-sub") as { user_id: string };
    expect(identity.user_id).toBe("author");
    const receipt = target.prepare(
      "SELECT 1 AS found FROM reply_receipts WHERE document_id = 'demo-post' AND user_id = 'reader'",
    ).get() as { found: number };
    expect(receipt.found).toBe(1);

    const targetDocuments = target.prepare("SELECT COUNT(*) AS count FROM documents").get() as {
      count: number;
    };
    expect(targetDocuments.count).toBe(sourceDocuments);
    const targetWallets = target
      .prepare("SELECT user_id, balance FROM wallets ORDER BY user_id")
      .all() as Array<{ user_id: string; balance: number }>;
    expect(targetWallets).toEqual(sourceWallets);
    const acl = target.prepare(
      "SELECT permission FROM document_acl WHERE document_id = 'demo-post' AND user_id = 'author'",
    ).get() as { permission: string };
    expect(acl.permission).toBe("admin");
    const readerAcl = target.prepare(
      "SELECT permission FROM document_acl WHERE document_id = 'demo-post' AND user_id = 'reader'",
    ).get() as { permission: string };
    expect(readerAcl.permission).toBe("edit");
    const guard = target.prepare(
      "SELECT decision FROM suggestion_review_guards WHERE suggestion_kind = 'single' AND suggestion_id = 'suggestion-1'",
    ).get() as { decision: string };
    expect(guard.decision).toBe("approve");
    const asset = target.prepare(
      "SELECT object_key, state FROM assets WHERE id = 'asset-export-test'",
    ).get() as { object_key: string; state: string };
    expect(asset).toEqual({ object_key: "legacy/legacy.png", state: "ready" });
    target.close();
  });

  it("rejects incomplete or ambiguous OIDC identity mappings", async () => {
    const sourcePath = join(directory, "identity-source.sqlite");
    createDatabase({ path: sourcePath }).close();
    const base = {
      databasePath: sourcePath,
      uploadsDirectory: join(directory, "uploads"),
      outputDirectory: join(directory, "identity-export"),
      exportedAt: "2026-09-02T00:00:00.000Z",
    };
    await expect(
      exportSqliteToCloudflare({ ...base, identityMappings: [] }),
    ).rejects.toThrow("Privileged users require OIDC identity mappings");
    await expect(
      exportSqliteToCloudflare({
        ...base,
        identityMappings: [
          { issuer: "https://id.example.com", subject: "same", userId: "author" },
          { issuer: "https://id.example.com", subject: "same", userId: "moderator" },
        ],
      }),
    ).rejects.toThrow("Duplicate OIDC identity mapping");
    await expect(
      exportSqliteToCloudflare({
        ...base,
        identityMappings: [
          { issuer: "https://id.example.com", subject: "ghost", userId: "missing-user" },
        ],
      }),
    ).rejects.toThrow("unknown user");
  });

  it("rejects missing objects and unmanaged local attachment URLs", async () => {
    const sourcePath = join(directory, "asset-source.sqlite");
    const source = createDatabase({ path: sourcePath });
    source.prepare(
      "INSERT INTO assets(id, original_name, stored_name, mime_type, byte_size, created_by, created_at) " +
        "VALUES ('missing-asset', 'missing.png', 'missing.png', 'image/png', 8, 'reader', ?)",
    ).run("2026-08-20T08:00:00.000Z");
    source.close();
    const options = {
      databasePath: sourcePath,
      uploadsDirectory: join(directory, "uploads"),
      outputDirectory: join(directory, "asset-export"),
      identityMappings: [
        { issuer: "https://id.example.com", subject: "author", userId: "author" },
        { issuer: "https://id.example.com", subject: "moderator", userId: "moderator" },
      ],
      exportedAt: "2026-09-02T00:00:00.000Z",
    };
    await expect(exportSqliteToCloudflare(options)).rejects.toThrow("Missing upload referenced by asset");

    const repaired = new DatabaseSync(sourcePath);
    repaired.prepare("DELETE FROM assets WHERE id = 'missing-asset'").run();
    repaired.prepare(
      "UPDATE attachments SET download_url = '/forum-downloads/legacy.txt' " +
        "WHERE id = 'attachment-sample'",
    ).run();
    repaired.close();
    await expect(exportSqliteToCloudflare(options)).rejects.toThrow("unmigratable local download URL");
  });
});
