import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";

type SqlValue = string | number | null;
type Row = Record<string, SqlValue | undefined>;

export interface IdentityMapping {
  issuer: string;
  subject: string;
  userId: string;
}

export interface ExportOptions {
  databasePath: string;
  uploadsDirectory: string;
  outputDirectory: string;
  identityMappings: readonly IdentityMapping[];
  exportedAt?: string;
}

function quote(value: SqlValue): string {
  if (value === null) return "NULL";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("Cannot export non-finite number");
    return String(value);
  }
  return "'" + value.replaceAll("'", "''") + "'";
}

function insert(table: string, row: Row, mode = ""): string {
  const columns = Object.keys(row);
  return (
    "INSERT" + (mode ? " " + mode : "") + " INTO " + table + "(" + columns.join(", ") + ") VALUES (" +
    columns.map((column) => quote(row[column] ?? null)).join(", ") +
    ");"
  );
}

function tableRows(db: DatabaseSync, table: string): Row[] {
  return db.prepare("SELECT * FROM " + table + " ORDER BY rowid").all() as Row[];
}

function selected(row: Row, columns: readonly string[]): Row {
  return Object.fromEntries(columns.map((column) => [column, row[column] ?? null]));
}

async function assetRows(
  db: DatabaseSync,
  uploadsDirectory: string,
): Promise<{
  rows: Row[];
  manifest: Array<{
    assetId: string;
    localPath: string;
    objectKey: string;
    byteSize: number;
    checksum: string | null;
    state: "ready" | "failed";
  }>;
}> {
  const rows: Row[] = [];
  const manifest = [];
  for (const source of tableRows(db, "assets")) {
    const storedName = String(source.stored_name);
    const localPath = resolve(uploadsDirectory, storedName);
    const objectKey = "legacy/" + basename(storedName);
    const exists = existsSync(localPath);
    const bytes = exists ? await readFile(localPath) : null;
    const checksum = bytes ? createHash("sha256").update(bytes).digest("hex") : null;
    const byteSize = bytes ? (await stat(localPath)).size : Number(source.byte_size);
    if (!exists) {
      throw new Error("Missing upload referenced by asset " + String(source.id) + ": " + localPath);
    }
    const state = "ready" as const;
    rows.push({
      id: source.id,
      original_name: source.original_name,
      object_key: objectKey,
      mime_type: source.mime_type,
      byte_size: byteSize,
      checksum,
      state,
      created_by: source.created_by,
      created_at: source.created_at,
      updated_at: source.created_at,
    });
    manifest.push({
      assetId: String(source.id),
      localPath,
      objectKey,
      byteSize,
      checksum,
      state,
    });
  }
  return { rows, manifest };
}

const directTables: Array<{ table: string; columns: readonly string[] }> = [
  { table: "documents", columns: ["id", "title", "schema_version", "current_revision", "created_by", "created_at", "updated_at"] },
  { table: "document_revisions", columns: ["document_id", "revision", "schema_version", "content_json", "steps_json", "author_id", "operation", "target_revision", "created_at"] },
  { table: "document_mutations", columns: ["document_id", "client_mutation_id", "request_json", "revision"] },
  { table: "chapters", columns: ["id", "title", "sort_order", "document_id", "revision", "content_json", "content_hash", "updated_at", "hidden"] },
  { table: "comment_threads", columns: ["document_id", "anchor_id", "archived", "created_at"] },
  { table: "comment_replies", columns: ["id", "document_id", "anchor_id", "parent_id", "author_id", "body", "created_at"] },
  { table: "comment_votes", columns: ["reply_id", "user_id", "value", "created_at"] },
  { table: "dice_rolls", columns: ["id", "root_roll_id", "previous_roll_id", "expression", "details_json", "total", "created_by", "created_at"] },
  { table: "suggestions", columns: ["id", "document_id", "chapter_id", "chapter_title", "line_no", "line_text", "from_text", "to_text", "reason", "status", "author_id", "reviewer_id", "created_at", "reviewed_at"] },
  { table: "suggestion_batches", columns: ["id", "document_id", "chapter_id", "chapter_title", "base_revision", "before_content_json", "after_content_json", "steps_json", "reason", "status", "author_id", "reviewer_id", "created_at", "reviewed_at"] },
  { table: "reply_gates", columns: ["id", "document_id", "content_json"] },
  { table: "reply_receipts", columns: ["document_id", "user_id", "created_at"] },
  { table: "attachment_purchases", columns: ["attachment_id", "buyer_id", "price", "author_income", "created_at"] },
  { table: "polls", columns: ["id", "question", "multiple", "minimum_role"] },
  { table: "poll_options", columns: ["id", "poll_id", "label", "sort_order"] },
  { table: "poll_votes", columns: ["id", "poll_id", "user_id", "created_at"] },
  { table: "poll_vote_options", columns: ["vote_id", "option_id"] },
];

/**
 * 将旧 SQLite 快照转换为 D1 SQL 与 R2 manifest。
 * 目标必须是未承载流量的全新 D1；任一身份、ACL 或文件校验失败都禁止产出可切流结果。
 */
export async function exportSqliteToCloudflare(options: ExportOptions): Promise<{
  sqlPath: string;
  manifestPath: string;
  reportPath: string;
}> {
  const exportedAt = options.exportedAt ?? new Date().toISOString();
  const db = new DatabaseSync(resolve(options.databasePath), { readOnly: true });
  try {
    await mkdir(resolve(options.outputDirectory), { recursive: true });
    // D1 的 wrangler 导入自行管理事务，生成文件不得包含 BEGIN/COMMIT。
    const sql: string[] = [
      "-- Generated by tools/cloudflare/export-sqlite.ts at " + exportedAt,
      "PRAGMA defer_foreign_keys = TRUE;",
      "DROP TRIGGER IF EXISTS attachment_purchase_checks_balance;",
      "DROP TRIGGER IF EXISTS attachment_purchase_moves_balance;",
    ];
    const counts: Record<string, number> = {};

    const users: Row[] = tableRows(db, "users").map((row) => ({
      ...selected(row, ["id", "name", "role", "is_friend", "bio"]),
      created_at: exportedAt,
      updated_at: exportedAt,
    }));
    counts.users = users.length;
    sql.push(...users.map((row) => insert("users", row)));

    // 特权身份必须在切流前绑定 OIDC subject，否则登录后会被误建为普通 reader。
    const knownUserIds = new Set(users.map((row) => String(row.id)));
    const privilegedUserIds = new Set(
      users
        .filter((row) => row.role === "author" || row.role === "moderator")
        .map((row) => String(row.id)),
    );
    for (const row of db
      .prepare(
        "SELECT created_by AS user_id FROM documents UNION " +
          "SELECT user_id FROM document_acl WHERE permission IN ('edit', 'admin')",
      )
      .all() as Array<{ user_id: string }>) {
      privilegedUserIds.add(row.user_id);
    }
    const mappedUsers = new Set<string>();
    const identities = new Set<string>();
    for (const mapping of options.identityMappings) {
      if (!knownUserIds.has(mapping.userId)) {
        throw new Error("Identity mapping references unknown user: " + mapping.userId);
      }
      const key = mapping.issuer + "|" + mapping.subject;
      if (identities.has(key)) throw new Error("Duplicate OIDC identity mapping: " + key);
      identities.add(key);
      mappedUsers.add(mapping.userId);
      sql.push(insert("auth_identities", {
        issuer: mapping.issuer,
        subject: mapping.subject,
        user_id: mapping.userId,
        created_at: exportedAt,
      }));
    }
    const unmapped = [...privilegedUserIds].filter((userId) => !mappedUsers.has(userId));
    if (unmapped.length > 0) {
      throw new Error("Privileged users require OIDC identity mappings: " + unmapped.join(", "));
    }
    counts.auth_identities = options.identityMappings.length;

    for (const item of directTables.slice(0, 3)) {
      const rows = tableRows(db, item.table).map((row) => selected(row, item.columns));
      counts[item.table] = rows.length;
      sql.push(...rows.map((row) => insert(item.table, row)));
    }

    const aclRows = tableRows(db, "document_acl").map((row) =>
      selected(row, ["document_id", "user_id", "permission", "created_at"]),
    );
    sql.push(...aclRows.map((row) => insert("document_acl", row)));
    counts.document_acl = aclRows.length;

    const assets = await assetRows(db, options.uploadsDirectory);
    counts.assets = assets.rows.length;
    sql.push(...assets.rows.map((row) => insert("assets", row)));

    for (const item of directTables.slice(3, 12)) {
      const rows = tableRows(db, item.table).map((row) => ({
        ...selected(row, item.columns),
        ...(item.table === "chapters" && !row.updated_at ? { updated_at: exportedAt } : {}),
      }));
      counts[item.table] = rows.length;
      sql.push(
        ...rows.map((row) =>
          insert(item.table, row, item.table === "reply_receipts" ? "OR IGNORE" : ""),
        ),
      );
    }
    sql.push(
      "INSERT OR IGNORE INTO reply_receipts(document_id, user_id, created_at) " +
        "SELECT document_id, author_id, MIN(created_at) FROM comment_replies " +
        "GROUP BY document_id, author_id;",
    );
    counts.reply_receipts = Number(
      (db.prepare(
        "SELECT COUNT(*) AS count FROM (" +
          "SELECT document_id, user_id FROM reply_receipts UNION " +
          "SELECT document_id, author_id AS user_id FROM comment_replies)",
      ).get() as { count: number }).count,
    );

    const wallets = tableRows(db, "wallets").map((row) => selected(row, ["user_id", "balance"]));
    counts.wallets = wallets.length;
    sql.push(...wallets.map((row) => insert("wallets", row, "OR REPLACE")));

    const attachments = tableRows(db, "attachments").map((row) => {
      const downloadUrl = String(row.download_url);
      const assetPrefix = "/api/assets/";
      const candidate = downloadUrl.startsWith(assetPrefix)
        ? downloadUrl.slice(assetPrefix.length)
        : "";
      const assetId = candidate && !candidate.includes("/") ? candidate : null;
      if (!assetId && downloadUrl.startsWith("/")) {
        throw new Error(
          "Attachment " + String(row.id) + " has an unmigratable local download URL: " + downloadUrl,
        );
      }
      return {
        id: row.id,
        name: row.name,
        mime_type: row.mime_type,
        price: row.price,
        author_id: row.author_id,
        asset_id: assetId,
        legacy_download_url: assetId ? null : downloadUrl,
      };
    });
    counts.attachments = attachments.length;
    sql.push(...attachments.map((row) => insert("attachments", row)));

    for (const item of directTables.slice(12)) {
      const rows = tableRows(db, item.table).map((row) => selected(row, item.columns));
      counts[item.table] = rows.length;
      sql.push(...rows.map((row) => insert(item.table, row)));
    }

    for (const [kind, table] of [["single", "suggestions"], ["batch", "suggestion_batches"]] as const) {
      for (const row of tableRows(db, table)) {
        if (row.status === "pending") continue;
        sql.push(insert("suggestion_review_guards", {
          suggestion_kind: kind,
          suggestion_id: row.id,
          decision: row.status === "approved" ? "approve" : "reject",
          reviewer_id: row.reviewer_id ?? row.author_id,
          created_at: row.reviewed_at ?? row.created_at,
        }));
      }
    }

    sql.push(
      "CREATE TRIGGER attachment_purchase_checks_balance BEFORE INSERT ON attachment_purchases BEGIN SELECT CASE WHEN COALESCE((SELECT balance FROM wallets WHERE user_id = NEW.buyer_id), 0) < NEW.price THEN RAISE(ABORT, 'INSUFFICIENT_COINS') END; END;",
      "CREATE TRIGGER attachment_purchase_moves_balance AFTER INSERT ON attachment_purchases BEGIN UPDATE wallets SET balance = balance - NEW.price WHERE user_id = NEW.buyer_id; INSERT INTO wallets(user_id, balance) SELECT author_id, NEW.author_income FROM attachments WHERE id = NEW.attachment_id ON CONFLICT(user_id) DO UPDATE SET balance = balance + NEW.author_income; END;",
    );

    const output = resolve(options.outputDirectory);
    const sqlPath = join(output, "d1-import.sql");
    const manifestPath = join(output, "r2-manifest.json");
    const reportPath = join(output, "verification-source.json");
    const newline = String.fromCharCode(10);
    await writeFile(sqlPath, sql.join(newline) + newline, "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({ exportedAt, items: assets.manifest }, null, 2) + newline,
      "utf8",
    );
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          exportedAt,
          sourceDatabase: resolve(options.databasePath),
          counts,
          r2: {
            ready: assets.manifest.filter((item) => item.state === "ready").length,
            missing: assets.manifest.filter((item) => item.state === "failed").map((item) => item.localPath),
            bytes: assets.manifest.reduce((total, item) => total + item.byteSize, 0),
          },
        },
        null,
        2,
      ) + newline,
      "utf8",
    );
    return { sqlPath, manifestPath, reportPath };
  } finally {
    db.close();
  }
}

function argument(name: string, fallback: string): string {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1]! : fallback;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const identityMapPath = argument("--identity-map", "");
  if (!identityMapPath) throw new Error("Missing required argument --identity-map");
  const identityMappings = JSON.parse(
    await readFile(resolve(identityMapPath), "utf8"),
  ) as IdentityMapping[];
  const result = await exportSqliteToCloudflare({
    databasePath: argument("--db", ".data/ricetext.sqlite"),
    uploadsDirectory: argument("--uploads", ".data/uploads"),
    outputDirectory: argument("--out", ".data/cloudflare-export"),
    identityMappings,
  });
  console.log(JSON.stringify(result, null, 2));
}
