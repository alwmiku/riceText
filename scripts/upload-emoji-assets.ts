/**
 * 把站点表情资源上传到 R2，供 Cloudflare Worker 提供
 * `GET /api/emoji/:emojiId/image`（Node 侧读的是本地文件，不需要这一步）。
 *
 * 对象键与本地目录保持一致：`emoji/<文件>` 与 `emoji/thumbs/<id>.png`，
 * 与 apps/worker/src/app.ts 里的读取路径一一对应；收集与上传逻辑复用
 * packages/cloudflare-migration 里的同一份实现，Cloudflare E2E 的种子也走它。
 *
 * 用法：
 *   pnpm.cmd emoji:r2 -- --bucket ricetext-development-uploads --local   # 本地模拟桶
 *   pnpm.cmd emoji:r2 -- --bucket <bucket>                               # 远端真实桶
 *   pnpm.cmd emoji:r2 -- --bucket <bucket> --dry-run                     # 只预演对象键
 */
import { join, resolve } from "node:path";
import {
  collectEmojiAssets,
  uploadR2Manifest,
} from "../packages/cloudflare-migration/src/r2-assets.js";
import { createWranglerRunner } from "../packages/cloudflare-migration/src/cli.js";

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
const manifest = collectEmojiAssets(
  join(root, "apps", "api", "src", "assets", "emoji"),
  new Date().toISOString(),
);

if (dryRun) {
  for (const item of manifest.items) {
    console.log(`DRY RUN: ${bucket}/${item.objectKey} <- ${item.localPath}`);
  }
  console.log(`已完成预演（${manifest.items.length} 个对象，未上传）。`);
} else {
  console.log(`准备上传 ${manifest.items.length} 个表情资源到 ${bucket}：`);
  const report = uploadR2Manifest({
    manifest,
    bucket,
    local,
    runner: createWranglerRunner(root),
    missingBucketHint:
      `远端桶 "${bucket}" 在当前 Cloudflare 账号里不存在（wrangler.jsonc 里的桶名只有在` +
      ` wrangler dev 的本地模拟里才会自动创建）。先确认账号里有哪些桶：` +
      `pnpm --filter @ricetext/worker exec wrangler r2 bucket list；` +
      `要新建就执行 pnpm --filter @ricetext/worker exec wrangler r2 bucket create ${bucket}；` +
      `要给线上站点放表情，请用生产桶 ricetext-production-uploads。`,
  });
  console.log(`已上传 ${report.uploaded} 个对象。`);
}
