// 每次浏览器测试都重建本地 D1，避免上一次运行产生的 revision 污染结果。
import { webcrypto } from "node:crypto";
import { appendFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PASSWORD_HASH_ITERATIONS } from "../../packages/contracts/src/schemas.js";
import { createDatabase } from "../../apps/api/src/db.js";
import { exportSqliteToCloudflare } from "../../packages/cloudflare-migration/src/export-sqlite.js";

const root = resolve(import.meta.dirname, "../..");
const data = join(root, ".data", "cloudflare-e2e");
const databasePath = join(data, "source.sqlite");
const outputDirectory = join(data, "export");
const persistTo = process.env.CF_E2E_PERSIST_TO
  ? resolve(root, process.env.CF_E2E_PERSIST_TO)
  : join(root, "apps", "worker", ".wrangler", "state");
await rm(data, { recursive: true, force: true });
await rm(persistTo, { recursive: true, force: true });
createDatabase({ path: databasePath }).close();
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
    "'author', 'writer', '" + Buffer.from(salt).toString("base64url") + "', '" +
    Buffer.from(hash).toString("base64url") + "', " + PASSWORD_HASH_ITERATIONS + ", 0, NULL, '2026-09-02T00:00:00.000Z');\n",
  "utf8",
);
const pnpmCli = process.env.npm_execpath;
const command = pnpmCli ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
for (const args of [
  [
    "--dir", "apps/worker", "exec", "wrangler", "d1", "migrations", "apply", "DB",
    "--local", "--persist-to", persistTo,
  ],
  [
    "--dir", "apps/worker", "exec", "wrangler", "d1", "execute", "DB",
    "--local", "--persist-to", persistTo, "--file", exported.sqlPath,
  ],
]) {
  const result = spawnSync(command, pnpmCli ? [pnpmCli, ...args] : args, {
    cwd: root,
    stdio: "inherit",
    shell: !pnpmCli && process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error(
      "Cloudflare E2E preparation command failed with status " + String(result.status),
    );
  }
}
console.log(JSON.stringify({ databasePath, importFile: exported.sqlPath, ready: true }, null, 2));
