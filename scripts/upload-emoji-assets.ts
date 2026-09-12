/**
 * 把站点表情资源上传到 R2，供 Cloudflare Worker 提供
 * `GET /api/emoji/:emojiId/image`（Node 侧读的是本地文件，不需要这一步）。
 *
 * 对象键与本地目录保持一致：`emoji/<文件>` 与 `emoji/thumbs/<id>.png`，
 * 与 apps/worker/src/app.ts 里的读取路径一一对应；收集与上传逻辑复用
 * packages/cloudflare-migration 里的同一份实现，Cloudflare E2E 的种子也走它。
 *
 * 用法：
 *   pnpm.cmd emoji:r2 -- --bucket ricetext-development-uploads --local      # 本地模拟桶
 *   pnpm.cmd emoji:r2 -- --bucket ricetext-production-uploads               # 远端真实桶
 *   pnpm.cmd emoji:r2 -- --bucket <bucket> --dry-run                        # 只预演对象键
 *   pnpm.cmd emoji:r2 -- --bucket <bucket> --resume                         # 只补缺失/过期的对象
 *
 * 远端上传中途断网时用 `--resume` 重跑：逐个探测桶里已有的对象，只补真正缺的那些。
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  collectEmojiAssets,
  uploadR2Manifest,
  type R2ManifestItem,
} from "../packages/cloudflare-migration/src/r2-assets.js";
import { createWranglerRunner } from "../packages/cloudflare-migration/src/cli.js";

/**
 * 远端上传失败时按 wrangler 的实际输出给出排查方向。
 *
 * `fetch failed` / 连接类报错是网络或代理问题，与桶名无关；只有 wrangler 明确说
 * 桶不存在时才该去建桶——把网络失败也说成「桶不存在」会把排查带偏。
 */
function remoteFailureHint(bucket: string, output: string): string | null {
  const commands =
    `先确认账号里有哪些桶：pnpm --filter @ricetext/worker exec wrangler r2 bucket list；` +
    `要新建就执行 pnpm --filter @ricetext/worker exec wrangler r2 bucket create ${bucket}。`;
  if (/does not exist|not find|NoSuchBucket/iu.test(output)) {
    return (
      `r2 bucket list 里没有 "${bucket}"：它只是 wrangler.jsonc 的绑定名，` +
      `远端只有 wrangler dev 的本地模拟桶会自动创建。${commands}`
    );
  }
  if (/fetch failed|network|ENOTFOUND|ETIMEDOUT|ECONNRESET|connectivity/iu.test(output)) {
    return (
      "wrangler 连接 Cloudflare API 失败（不是桶名的问题）：检查网络/代理是否能访问 api.cloudflare.com，" +
      '代理环境下可先 "set HTTPS_PROXY=" 清掉再试，或改用能直连的网络。' +
      commands
    );
  }
  if (/CLOUDFLARE_API_TOKEN|not authenticated|login/iu.test(output)) {
    return (
      "wrangler 没有可用凭据：先 pnpm --filter @ricetext/worker exec wrangler login，" +
      "或设置 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID。"
    );
  }
  return null;
}
/**
 * 探测某个对象是否已经在桶里且内容一致（`--resume` 用）。
 *
 * 本版 wrangler 没有 `r2 object list`，只能把对象取回来比字节：取不到就是缺失、
 * 字节不一致就是旧内容，两种情况都重新上传。命中跳过时也要下载一次，但正好省掉
 * 同样大小的上传，价值在于「断网重跑」只补真正缺的对象。
 */
function createUploadedProbe(
  bucket: string,
  local: boolean,
  runner: ReturnType<typeof createWranglerRunner>,
): (item: R2ManifestItem) => boolean {
  const directory = mkdtempSync(join(tmpdir(), "ricetext-r2-resume-"));
  return (item) => {
    const downloaded = join(directory, "probe");
    const result = runner([
      "r2",
      "object",
      "get",
      // 中文文件名在写入时被 wrangler 做了 URL 编码（Worker 读取时也 encodeURI），
      // 所以探测必须用编码后的键，否则会误判成「不存在」而重复上传。
      bucket + "/" + encodeURI(item.objectKey),
      "--file",
      downloaded,
      ...(local ? ["--local"] : ["--remote"]),
    ]);
    if (result.status !== 0) return false;
    try {
      return readFileSync(downloaded).equals(readFileSync(item.localPath));
    } catch {
      return false;
    } finally {
      rmSync(downloaded, { force: true });
    }
  };
}

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
// 断网重跑时只补缺失/过期的对象，不把已经传成功的动图再传一遍。
const resume = process.argv.includes("--resume");
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
  const runner = createWranglerRunner(root);
  const report = uploadR2Manifest({
    manifest,
    bucket,
    local,
    runner,
    // 远端上传是逐个对象走 API，代理/网络抖动很常见：默认重试 4 次。
    attempts: local ? 1 : 4,
    ...(local
      ? {}
      : {
          failureHint: ({ output }: { output: string }) => remoteFailureHint(bucket, output),
        }),
    ...(resume ? { alreadyUploaded: createUploadedProbe(bucket, local, runner) } : {}),
  });
  console.log(`已上传 ${report.uploaded} 个对象，跳过 ${report.skipped} 个。`);
}
