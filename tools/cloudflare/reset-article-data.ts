import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const local = process.argv.includes("--local");
const sqlitePath = argument("--sqlite");
const environment = local ? "local" : argument("--env");
const expectedDatabase =
  environment === "production"
    ? "ricetext-production"
    : environment === "preview"
      ? "ricetext-preview"
      : "ricetext-development";
const confirmation = argument("--confirm");

if (sqlitePath && (local || environment)) {
  throw new Error("--sqlite 不能与 --local 或 --env 同时使用");
}
if (!sqlitePath && !local && environment !== "preview" && environment !== "production") {
  throw new Error("请使用 --sqlite <路径>、--local，或指定 --env preview|production");
}
if (confirmation !== expectedDatabase) {
  throw new Error(
    `拒绝重置：请显式传入 --confirm ${expectedDatabase}`,
  );
}

const resetSql = `
PRAGMA defer_foreign_keys = TRUE;
DELETE FROM chapter_upload_items;
DELETE FROM chapter_uploads;
DELETE FROM suggestion_review_guards;
DELETE FROM suggestion_batches;
DELETE FROM suggestions;
DELETE FROM comment_votes;
DELETE FROM comment_replies;
DELETE FROM comment_threads;
DELETE FROM reply_receipts;
DELETE FROM reply_gates;
DELETE FROM chapters;
DELETE FROM document_mutations;
DELETE FROM document_revisions;
DELETE FROM document_acl;
DELETE FROM documents;
`;

if (sqlitePath) {
  const databasePath = resolve(sqlitePath);
  const db = new DatabaseSync(databasePath);
  try {
    db.exec("PRAGMA foreign_keys = ON");
    const existingTables = new Set(
      (
        db
          .prepare("SELECT name FROM sqlite_schema WHERE type = 'table'")
          .all() as Array<{ name: string }>
      ).map((row) => row.name),
    );
    const articleTables = [
      "chapter_upload_items",
      "chapter_uploads",
      "suggestion_review_guards",
      "suggestion_batches",
      "suggestions",
      "comment_votes",
      "comment_replies",
      "comment_threads",
      "reply_receipts",
      "reply_gates",
      "chapters",
      "document_mutations",
      "document_revisions",
      "document_acl",
      "documents",
    ];
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec("PRAGMA defer_foreign_keys = TRUE");
      for (const table of articleTables) {
        if (existingTables.has(table)) db.exec(`DELETE FROM ${table}`);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    const documents = db.prepare("SELECT COUNT(*) AS count FROM documents").get() as {
      count: number;
    };
    const chapters = db.prepare("SELECT COUNT(*) AS count FROM chapters").get() as {
      count: number;
    };
    const foreignKeys = db.prepare("SELECT COUNT(*) AS count FROM pragma_foreign_key_check").get() as {
      count: number;
    };
    if (documents.count !== 0 || chapters.count !== 0 || foreignKeys.count !== 0) {
      throw new Error("SQLite 文章域重置校验失败");
    }
    console.log(`已重置 ${databasePath} 的文章域，账号与认证数据保持不变。`);
  } finally {
    db.close();
  }
  process.exit(0);
}

const directory = resolve(".data", "reset");
const file = resolve(directory, `article-reset-${randomUUID()}.sql`);
await mkdir(directory, { recursive: true });
await writeFile(file, resetSql, { encoding: "utf8", mode: 0o600 });

function wrangler(args: string[], capture = false): string {
  const pnpmCli = process.env.npm_execpath;
  const command = pnpmCli
    ? process.execPath
    : process.platform === "win32"
      ? "pnpm.cmd"
      : "pnpm";
  const result = spawnSync(
    command,
    pnpmCli ? [pnpmCli, ...args] : args,
    {
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
      shell: !pnpmCli && process.platform === "win32",
    },
  );
  if (result.status !== 0) {
    throw new Error(
      result.stderr || result.stdout || `Wrangler 退出码 ${String(result.status)}`,
    );
  }
  return result.stdout ?? "";
}

const targetArgs = local
  ? ["--local"]
  : ["--remote", "--env", environment!];
const baseArgs = [
  "--dir",
  "apps/worker",
  "exec",
  "wrangler",
  "d1",
  "execute",
  "DB",
  ...targetArgs,
];

try {
  wrangler([...baseArgs, "--file", file]);
  const verification = wrangler(
    [
      ...baseArgs,
      "--command",
      "SELECT COUNT(*) AS documents FROM documents; " +
        "SELECT COUNT(*) AS chapters FROM chapters; " +
        "SELECT COUNT(*) AS foreign_key_failures FROM pragma_foreign_key_check;",
      "--json",
    ],
    true,
  );
  const values = JSON.parse(verification) as Array<{
    results?: Array<Record<string, number>>;
  }>;
  const rows = values.flatMap((value) => value.results ?? []);
  const failures = rows.find((row) => "foreign_key_failures" in row);
  if (
    !rows.some((row) => row.documents === 0) ||
    !rows.some((row) => row.chapters === 0) ||
    failures?.foreign_key_failures !== 0
  ) {
    throw new Error(`文章域重置校验失败：${verification}`);
  }
  console.log(`已重置 ${expectedDatabase} 的文章域，账号与认证数据保持不变。`);
} finally {
  await rm(file, { force: true });
}
