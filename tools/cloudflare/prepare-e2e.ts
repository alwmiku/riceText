// 每次浏览器测试都重建本地 D1，避免上一次运行产生的 revision 污染结果。
//
// 数据来源是「D1 migrations + 演示种子」：schema 只有 apps/worker/migrations 一份，
// 种子由 tools/cloudflare/d1-seed.ts 生成 SQL 后通过 `d1 execute --file` 写入。
// 站点表情不在这里准备：把仓库里的图片上传到 R2 是一次性动作
// （pnpm emoji:r2 -- --bucket <桶> --local），放进测试准备里逐个对象跑 wrangler
// 既慢又会因为一次失败让整批测试起不来（CI 曾经每跑必崩）。
// E2E 的持久化目录由 playwright.config.ts 指定（.data/cloudflare-e2e-state），
// 不再动开发者本地 dev 服务正在用的 apps/worker/.wrangler/state。
// 这里只清「必须每次重建」的模拟状态，`v3/r2` 原样保留，让一次性种子跨测试复用；
// e2e/emoji.spec.ts 只在桶里真的有图时才断言图片字节。
import { webcrypto } from "node:crypto";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { PASSWORD_HASH_ITERATIONS } from "../../packages/contracts/src/schemas.js";
import { demoSeedStatements, EMPTY_DOCUMENTS_SQL, seedSql } from "./d1-seed.js";

const root = resolve(import.meta.dirname, "../..");
const data = join(root, ".data", "cloudflare-e2e");
const seedPath = join(data, "seed.sql");
// 开发者的本地库（apps/worker/.wrangler/state）里是真实创作数据，绝不能被测试准备删掉。
// 早先这里在缺少 CF_E2E_PERSIST_TO 时「默认指向」开发状态目录，等于把本地库当测试库清空，
// 因此现在缺少变量就直接失败：唯一合法的目标是 E2E 专用目录。
const developerState = join(root, "apps", "worker", ".wrangler", "state");
const requestedState = process.env.CF_E2E_PERSIST_TO;
if (!requestedState) {
  throw new Error(
    "缺少 CF_E2E_PERSIST_TO：本命令会清空目标 D1，不能对开发者的 apps/worker/.wrangler/state 运行。" +
      "请由 Playwright（playwright.config.ts）传入 E2E 专用目录，例如" +
      " CF_E2E_PERSIST_TO=.data/cloudflare-e2e-state。",
  );
}
const persistTo = resolve(root, requestedState);
if (persistTo === developerState || developerState.startsWith(persistTo + sep)) {
  throw new Error(
    "拒绝清空开发状态目录：" +
      persistTo +
      " 覆盖了 apps/worker/.wrangler/state。" +
      "请改用 E2E 专用状态目录（.data/cloudflare-e2e-state）。",
  );
}

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
 * 迁移可重放（已应用的会跳过）；种子语句幂等，导入失败重跑也不会留下影响断言的数据。
 */
function runWranglerWithRetry(args: readonly string[], attempts = 3): number {
  let status = runWrangler(args);
  for (let attempt = 2; status !== 0 && attempt <= attempts; attempt += 1) {
    console.log("wrangler 失败，第 " + String(attempt) + " 次重试：" + args.join(" "));
    status = runWrangler(args);
  }
  return status;
}

await rm(data, { recursive: true, force: true });
await resetLocalState();
await mkdir(data, { recursive: true });

// 同源密码登录 E2E 使用固定测试凭据；只写入被忽略的临时 D1。
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

// 密码登录用例要求「没有任何文章」：种子只写账号与凭据，并额外清一次文章域
// （只删不跳过插入是无效的：插入语句紧接着删除就会把演示文章建回来）。
const emptyDocuments = process.env.CF_E2E_EMPTY_DOCUMENTS === "true";
const statements = demoSeedStatements({
  now: "2026-09-02T00:00:00.000Z",
  includeDocuments: !emptyDocuments,
  password: {
    userId: "author",
    username: "writer",
    salt: Buffer.from(salt).toString("base64url"),
    passwordHash: Buffer.from(hash).toString("base64url"),
  },
});
if (emptyDocuments) statements.unshift(...EMPTY_DOCUMENTS_SQL);
await writeFile(seedPath, seedSql(statements), "utf8");

for (const args of [
  ["d1", "migrations", "apply", "DB", "--local", "--persist-to", persistTo],
  ["d1", "execute", "DB", "--local", "--persist-to", persistTo, "--file", seedPath],
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
console.log(JSON.stringify({ seedPath, persistTo, ready: true }, null, 2));
