import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** wrangler 单次调用的结果：状态码 + 合并后的 stdout/stderr（用于判定失败原因）。 */
export interface WranglerResult {
  status: number;
  output: string;
}

/** 调用 wrangler 的 host 回调：负责跨平台地拉起 CLI 并把输出透传给用户。 */
export type WranglerRunner = (args: readonly string[]) => WranglerResult;

/** 仓库里 wrangler CLI 的位置（只有 apps/worker 装了它）。 */
export function wranglerCliPath(root: string): string {
  return join(root, "apps", "worker", "node_modules", "wrangler", "bin", "wrangler.js");
}

/**
 * 跨平台拉起 wrangler：管道透传 stdout/stderr 的同时留一份输出，便于失败时区分
 * 「桶不存在」和「网络/凭据问题」——两者的排查方向完全不同。
 */
export function createWranglerRunner(root: string): WranglerRunner {
  const cli = wranglerCliPath(root);
  if (!existsSync(cli)) {
    throw new Error("找不到 wrangler CLI：" + cli + "；先执行 pnpm install");
  }
  return (args) => {
    const result = spawnSync(process.execPath, [cli, ...args], {
      cwd: join(root, "apps", "worker"),
      encoding: "utf8",
    });
    const output = String(result.stdout ?? "") + String(result.stderr ?? "");
    if (output) process.stderr.write(output);
    return { status: result.status ?? 1, output };
  };
}
