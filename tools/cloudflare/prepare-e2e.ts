// 每次浏览器测试都重建本地 D1，避免上一次运行产生的 revision 污染结果。
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { createDatabase } from "../../apps/api/src/db.js";
import { exportSqliteToCloudflare } from "../../packages/cloudflare-migration/src/export-sqlite.js";

const root = resolve(import.meta.dirname, "../..");
const data = join(root, ".data", "cloudflare-e2e");
const databasePath = join(data, "source.sqlite");
const outputDirectory = join(data, "export");
await rm(data, { recursive: true, force: true });
await rm(join(root, "apps", "worker", ".wrangler", "state"), { recursive: true, force: true });
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
const pnpmCli = process.env.npm_execpath;
const command = pnpmCli ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
for (const args of [
  ["--filter", "@ricetext/worker", "d1:migrate:local"],
  ["--dir", "apps/worker", "exec", "wrangler", "d1", "execute", "DB", "--local", "--file", exported.sqlPath],
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
