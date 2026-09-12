/**
 * 把站点表情资源上传到 R2，供 Cloudflare Worker 提供
 * `GET /api/emoji/:emojiId/image`（Node 侧读的是本地文件，不需要这一步）。
 *
 * 对象键与本地目录保持一致：`emoji/<文件>` 与 `emoji/thumbs/<id>.png`，
 * 与 apps/worker/src/app.ts 里的读取路径一一对应。
 *
 * 用法：
 *   pnpm.cmd emoji:r2 -- --bucket ricetext-development-uploads --local   # 本地模拟桶
 *   pnpm.cmd emoji:r2 -- --bucket <bucket>                               # 远端真实桶
 *   pnpm.cmd emoji:r2 -- --bucket <bucket> --dry-run                     # 只预演对象键
 */
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error(`缺少必需参数 ${name}`);
  return value;
}

const bucket = argument("--bucket");
const dryRun = process.argv.includes("--dry-run");
// 本地开发时目标应是 miniflare 模拟的桶，而不是真远端。
const local = process.argv.includes("--local");
const root = resolve(import.meta.dirname, "..");
const assetsRoot = join(root, "apps", "api", "src", "assets", "emoji");

/** 收集 flat 目录里的文件，生成 [本地路径, 对象键] 列表。 */
function collect(directory: string, prefix: string): Array<[string, string]> {
  const entries: Array<[string, string]> = [];
  for (const name of readdirSync(directory)) {
    const fullPath = join(directory, name);
    if (statSync(fullPath).isDirectory()) {
      entries.push(...collect(fullPath, `${prefix}${name}/`));
      continue;
    }
    // 只上传图片：目录里不该混入其它类型，出现即报错，避免静默漏传。
    if (!/\.(gif|png)$/iu.test(name)) {
      throw new Error(`表情目录里出现非图片文件：${fullPath}`);
    }
    entries.push([fullPath, `emoji/${prefix}${name}`]);
  }
  return entries;
}

const items = collect(assetsRoot, "");
if (items.length === 0) throw new Error("表情目录为空，先确认 apps/api/src/assets/emoji 已提交");

console.log(`准备上传 ${items.length} 个表情资源到 ${bucket}：`);
for (const [localPath, objectKey] of items) {
  const objectPath = `${bucket}/${objectKey}`;
  if (dryRun) {
    console.log(`DRY RUN: ${objectPath} <- ${localPath}`);
    continue;
  }
  // 直接调用 wrangler CLI：经 pnpm 转发会丢失 `--` 之后的参数。
  const wranglerCli = resolve(
    root,
    "apps",
    "worker",
    "node_modules",
    "wrangler",
    "bin",
    "wrangler.js",
  );
  if (!existsSync(wranglerCli)) {
    throw new Error(`找不到 wrangler CLI：${wranglerCli}；先 pnpm install`);
  }
  console.log(`上传 ${objectPath}`);
  // 文件名可能含中文：用 file:// URL 传参可避免 Windows/Git Bash 的路径编码问题。
  const fileUrl = pathToFileURL(localPath).href;
  const result = spawnSync(
    process.execPath,
    [
      wranglerCli,
      "r2",
      "object",
      "put",
      objectPath,
      "--file",
      fileUrl,
      local ? "--local" : "--remote",
    ],
    { stdio: "inherit", cwd: resolve(root, "apps", "worker") },
  );
  if (result.status !== 0) throw new Error(`R2 上传失败：${objectPath}`);
}
console.log(dryRun ? "已完成预演（未上传）。" : `已上传 ${items.length} 个对象。`);
