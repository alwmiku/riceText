// 每次浏览器测试都重建本地 D1，避免上一次运行产生的 revision 污染结果。
import { webcrypto } from "node:crypto";
import { appendFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PASSWORD_HASH_ITERATIONS } from "../../packages/contracts/src/schemas.js";
import { createDatabase } from "../../apps/api/src/db.js";
import { exportSqliteToCloudflare } from "../../packages/cloudflare-migration/src/export-sqlite.js";
import {
  collectEmojiAssets,
  uploadR2Manifest,
} from "../../packages/cloudflare-migration/src/r2-assets.js";

const root = resolve(import.meta.dirname, "../..");
const data = join(root, ".data", "cloudflare-e2e");
const databasePath = join(data, "source.sqlite");
const outputDirectory = join(data, "export");
const persistTo = process.env.CF_E2E_PERSIST_TO
  ? resolve(root, process.env.CF_E2E_PERSIST_TO)
  : join(root, "apps", "worker", ".wrangler", "state");
await rm(data, { recursive: true, force: true });
await rm(persistTo, { recursive: true, force: true });
const sourceDatabase = createDatabase({ path: databasePath });
if (process.env.CF_E2E_EMPTY_DOCUMENTS === "true") {
  // 在导出前清空文章域，生成的 D1 SQL 从一开始就满足外键约束。
  sourceDatabase.exec(`
    DELETE FROM comment_votes;
    DELETE FROM comment_replies;
    DELETE FROM comment_threads;
    DELETE FROM suggestion_batches;
    DELETE FROM suggestions;
    DELETE FROM reply_receipts;
    DELETE FROM reply_gates;
    DELETE FROM chapters;
    DELETE FROM document_mutations;
    DELETE FROM document_revisions;
    DELETE FROM document_acl;
    DELETE FROM documents;
  `);
}
sourceDatabase.close();
const exported = await exportSqliteToCloudflare({
  databasePath,
  uploadsDirectory: join(data, "uploads"),
  outputDirectory,
  identityMappings: [
    { issuer: "https://e2e.invalid", subject: "author", userId: "author" },
    { issuer: "https://e2e.invalid", subject: "moderator", userId: "moderator" },
  ],
  exportedAt: "2026-09-02T00:00:00.000Z",
});
// 同源密码登录 E2E 使用固定测试凭据；只写入被忽略的临时 D1 导入文件。
const password = "local-test-password";
const salt = new TextEncoder().encode("ricetext-e2e-salt");
const key = await webcrypto.subtle.importKey(
  "raw",
  new TextEncoder().encode(password),
  "PBKDF2",
  false,
  ["deriveBits"],
);
const hash = await webcrypto.subtle.deriveBits(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations: PASSWORD_HASH_ITERATIONS },
  key,
  256,
);
await appendFile(
  exported.sqlPath,
  "INSERT INTO password_credentials(user_id, username, salt, password_hash, iterations, failed_attempts, locked_until, updated_at) VALUES (" +
    "'author', 'writer', '" +
    Buffer.from(salt).toString("base64url") +
    "', '" +
    Buffer.from(hash).toString("base64url") +
    "', " +
    PASSWORD_HASH_ITERATIONS +
    ", 0, NULL, '2026-09-02T00:00:00.000Z');\n",
  "utf8",
);
/** 跨平台拉起 pnpm；npm_execpath 指向 JS 入口（.cjs/.mjs）时直接交给 node 执行。 */
function runPnpm(args: readonly string[]): number {
  const entry = process.env.npm_execpath;
  const useNode = entry !== undefined && /\.(c?js|mjs)$/u.test(entry);
  const command = useNode ? process.execPath : (entry ?? "pnpm");
  const commandArgs = useNode ? [entry!, ...args] : [...args];
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: "inherit",
    shell: !useNode && process.platform === "win32",
  });
  return result.status ?? 1;
}

function runWrangler(args: readonly string[]): number {
  return runPnpm(["--dir", "apps/worker", "exec", "wrangler", ...args]);
}

for (const args of [
  ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo],
  ["d1", "execute", "DB", "--local", "--persist-to", persistTo, "--file", exported.sqlPath],
]) {
  const status = runWrangler(args);
  if (status !== 0) {
    throw new Error("Cloudflare E2E preparation command failed with status " + String(status));
  }
}
// 本地模拟桶同样要放站点表情：Worker 从 R2 取图（Node API 才是读磁盘），
// 少了这一步工具栏插入的表情会 404，桌面表情用例必然失败。
const emoji = uploadR2Manifest({
  manifest: collectEmojiAssets(
    join(root, "apps", "api", "src", "assets", "emoji"),
    "2026-09-02T00:00:00.000Z",
  ),
  bucket: "ricetext-development-uploads",
  local: true,
  runner: (args) => runWrangler([...args, "--persist-to", persistTo]),
});
console.log(
  JSON.stringify(
    { databasePath, importFile: exported.sqlPath, r2: { emoji }, ready: true },
    null,
    2,
  ),
);
