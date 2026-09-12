import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** 仓库里 wrangler CLI 的位置（只有 apps/worker 装了它）。 */
export function wranglerCliPath(root: string): string {
  return join(root, "apps", "worker", "node_modules", "wrangler", "bin", "wrangler.js");
}

/**
 * 跨平台拉起 wrangler：`npm_execpath` 指向 pnpm 的 JS 入口（.cjs/.mjs）时交给 node，
 * 指向可执行文件（Windows 的 pnpm.exe）时直接执行——早期写法用 node 去跑 .exe 会直接崩。
 */
export function createWranglerRunner(root: string): (args: readonly string[]) => number {
  const cli = wranglerCliPath(root);
  if (!existsSync(cli)) {
    throw new Error("找不到 wrangler CLI：" + cli + "；先执行 pnpm install");
  }
  return (args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: join(root, "apps", "worker"),
      stdio: "inherit",
    });
    return result.status ?? 1;
  };
}
