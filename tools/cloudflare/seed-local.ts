// 给本地开发的 Wrangler D1 播种演示数据（apps/worker/.wrangler/state）。
//
// 与 E2E 用的 tools/cloudflare/prepare-e2e.ts 同一份种子，区别只在目标状态目录：
// 这个命令不会删除任何状态，可以反复执行——种子语句本身幂等。
// E2E 必须每次重建 D1（上一次运行的 revision 会污染断言），所以那边会先清状态目录。
//
// 用法：
//   pnpm.cmd cf:seed:local                       # 默认 apps/worker/.wrangler/state
//   pnpm.cmd cf:seed:local -- --persist-to .data/other-state
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { demoSeedStatements, seedSql } from "./d1-seed.js";

const root = resolve(import.meta.dirname, "../..");
const arguments_ = process.argv.slice(2).filter((value) => value !== "--");
const persistIndex = arguments_.indexOf("--persist-to");
const persistTo = resolve(
  root,
  persistIndex >= 0 ? arguments_[persistIndex + 1]! : join("apps", "worker", ".wrangler", "state"),
);
const seedPath = join(root, ".data", "d1-seed", "seed.sql");

function runWrangler(args: readonly string[]): number {
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

await mkdir(join(root, ".data", "d1-seed"), { recursive: true });
await writeFile(seedPath, seedSql(demoSeedStatements({ now: new Date().toISOString() })), "utf8");

for (const args of [
  [
    "--dir",
    "apps/worker",
    "exec",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "DB",
    "--local",
    "--persist-to",
    persistTo,
  ],
  [
    "--dir",
    "apps/worker",
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    "--local",
    "--persist-to",
    persistTo,
    "--file",
    seedPath,
  ],
]) {
  const status = runWrangler(args);
  if (status !== 0) {
    throw new Error("本地 D1 播种失败（退出码 " + String(status) + "）：" + args.join(" "));
  }
}
console.log(JSON.stringify({ persistTo, seedPath, ready: true }, null, 2));
