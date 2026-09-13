// 每次浏览器测试都重建本地 D1，避免上一次运行产生的 revision 污染结果。
//
// 站点表情不在这里准备：把仓库里的图片上传到 R2 是一次性动作
// （pnpm emoji:r2 -- --bucket <桶> --local），放进测试准备里逐个对象跑 wrangler
// 既慢又会因为一次失败让整批测试起不来（CI 曾经每跑必崩）。
// E2E 的持久化目录由 playwright.cloudflare.config.ts 指定（.data/cloudflare-e2e-state），
// 不再动开发者本地 dev 服务正在用的 apps/worker/.wrangler/state。
// 这里只清「必须每次重建」的模拟状态，`v3/r2` 原样保留，让一次性种子跨测试复用；
// e2e/emoji.spec.ts 只在桶里真的有图时才断言图片字节。
import { webcrypto } from "node:crypto";
import { appendFile, readdir, rm } from "node:fs/promises";
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

/**
 * 重置本地模拟状态：D1 必须每次重建（上一次运行的 revision 会污染断言），
 * `v3/r2` 除外——里面的站点表情是一次性种子，删掉就得整批重传。
 */
async function resetLocalState(): Promise<void> {
  const stateRoot = join(persistTo, "v3");
  let entries: string[];
  try {
    entries = await readdir(stateRoot);
  } catch {
    return; // 还没有任何本地状态，没什么可清的。
  }
  for (const entry of entries) {
    if (entry === "r2") continue;
    const target = join(stateRoot, entry);
    try {
      await rm(target, { recursive: true, force: true });
    } catch (error) {
      // Windows 上还有 wrangler dev/workerd 占着这些文件时是 EBUSY：只说
      // "rmdir failed" 看不出下一步该做什么。
      throw new Error(
        "本地模拟状态被占用，无法重置：" +
          target +
          "\n通常是上一次 E2E 或 wrangler dev 没有退出干净；先结束它" +
          '（Windows：taskkill /F /PID <进程号>，macOS/Linux：pkill -f "wrangler dev"）再重跑。',
        { cause: error },
      );
    }
  }
}

await rm(data, { recursive: true, force: true });
await resetLocalState();
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

/**
 * wrangler 本地模式偶发起不来（一次性报 "bad port" 之类，重跑就好）。
 * 迁移可重放（已应用的会跳过）；导入失败重跑时会因主键冲突继续失败，不会静默留下半份数据。
 */
function runWranglerWithRetry(args: readonly string[], attempts = 3): number {
  let status = runWrangler(args);
  for (let attempt = 2; status !== 0 && attempt <= attempts; attempt += 1) {
    console.log("wrangler 失败，第 " + String(attempt) + " 次重试：" + args.join(" "));
    status = runWrangler(args);
  }
  return status;
}

for (const args of [
  ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo],
  ["d1", "execute", "DB", "--local", "--persist-to", persistTo, "--file", exported.sqlPath],
]) {
  const status = runWranglerWithRetry(args);
  if (status !== 0) {
    throw new Error(
      "Cloudflare E2E preparation command failed with status " +
        String(status) +
        "：" +
        args.join(" "),
    );
  }
}
console.log(JSON.stringify({ databasePath, importFile: exported.sqlPath, ready: true }, null, 2));
