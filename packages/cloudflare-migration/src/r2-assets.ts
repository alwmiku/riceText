import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import type { WranglerRunner } from "./cli.js";

/** R2 迁移 manifest 的一条记录（与 export-sqlite 输出的 r2-manifest.json 同构）。 */
export interface R2ManifestItem {
  localPath: string;
  objectKey: string;
  byteSize: number;
  checksum: string | null;
  state: "ready" | "failed";
}

export interface R2Manifest {
  exportedAt: string;
  items: R2ManifestItem[];
}

/** 调用 wrangler 的 host 回调：负责跨平台地拉起 CLI，并回传状态码与输出。 */
export type { WranglerResult, WranglerRunner } from "./cli.js";

/**
 * 收集站点表情资源，生成与本地目录一致的 R2 对象键。
 *
 * 键必须与 Worker 的读取路径（apps/worker/src/app.ts 中 `emoji/<文件>` 与
 * `emoji/thumbs/<id>.png`）以及 scripts/upload-emoji-assets.ts 完全一致，
 * 否则部署环境取不到图片（Node API 直接读磁盘，会掩盖这个问题）。
 */
export function collectEmojiAssets(assetsRoot: string, exportedAt: string): R2Manifest {
  const items: R2ManifestItem[] = [];
  const walk = (directory: string, prefix: string) => {
    for (const name of readdirSync(directory).sort()) {
      const fullPath = join(directory, name);
      if (statSync(fullPath).isDirectory()) {
        walk(fullPath, prefix + name + "/");
        continue;
      }
      if (!/\.(gif|png)$/iu.test(name)) {
        throw new Error("表情目录里出现非图片文件：" + fullPath);
      }
      const bytes = readFileSync(fullPath);
      items.push({
        localPath: fullPath,
        objectKey: "emoji/" + prefix + name,
        byteSize: bytes.byteLength,
        checksum: createHash("sha256").update(bytes).digest("hex"),
        state: "ready",
      });
    }
  };
  walk(assetsRoot, "");
  if (items.length === 0) throw new Error("表情目录为空，先确认 apps/api/src/assets/emoji 已提交");
  return { exportedAt, items };
}

/** 校验本地文件与 manifest 记录的校验和一致，避免上传到过期内容。 */
export function verifyManifestItem(item: R2ManifestItem): void {
  const checksum = createHash("sha256").update(readFileSync(item.localPath)).digest("hex");
  if (checksum !== item.checksum) {
    throw new Error("Checksum changed after export: " + item.localPath);
  }
}

export interface UploadR2ManifestOptions {
  manifest: R2Manifest;
  bucket: string;
  runner: WranglerRunner;
  /** true 走本地模拟桶（--local），false 走远端真实桶（--remote）。 */
  local: boolean;
  /**
   * 失败时根据 wrangler 的实际输出生成排查提示（可区分「桶不存在」与
   * 「网络/凭据问题」——这两类失败的排查方向完全不同，不能一律按桶不存在解释）。
   */
  failureHint?: (context: { bucket: string; objectKey: string; output: string }) => string | null;
  /**
   * 判断某个对象是否已经在目标桶里且内容一致（`--resume` 用）。
   *
   * 远端上传可能因网络中断半途失败，重跑时逐个探测就能只补缺失的那些，不用把
   * 已经传成功的几十兆动图再传一遍。探测由调用方实现：这一层只关心「跳过与否」。
   */
  alreadyUploaded?: (item: R2ManifestItem) => boolean;
}

/**
 * 把 manifest 里的对象写进 R2。
 *
 * 本地模拟桶与远端桶都走 `wrangler r2 object put`：对象键的 URL 编码行为必须与
 * 部署时完全一致（中文文件名就是靠这一层编码对齐的）。`local` 只影响传给
 * wrangler 的目标参数（由 `runner` 组装）。
 */
export function uploadR2Manifest(options: UploadR2ManifestOptions): {
  planned: number;
  uploaded: number;
  skipped: number;
} {
  const { manifest, bucket, runner, local, failureHint, alreadyUploaded } = options;
  let planned = 0;
  let uploaded = 0;
  let skipped = 0;
  for (const item of manifest.items) {
    if (item.state !== "ready" || !item.checksum) {
      skipped += 1;
      continue;
    }
    verifyManifestItem(item);
    if (alreadyUploaded?.(item)) {
      console.log("跳过已存在且一致的对象 " + bucket + "/" + item.objectKey);
      skipped += 1;
      continue;
    }
    planned += 1;
    console.log("上传 " + bucket + "/" + item.objectKey + " <- " + item.localPath);
    const result = runner([
      "r2",
      "object",
      "put",
      bucket + "/" + item.objectKey,
      // 直接给本地路径：wrangler 需要真实文件路径（file:// URL 会被当成路径字面量）。
      "--file",
      item.localPath,
      ...(local ? ["--local"] : ["--remote"]),
    ]);
    if (result.status !== 0) {
      const hint = failureHint?.({
        bucket,
        objectKey: item.objectKey,
        output: result.output,
      });
      throw new Error("R2 上传失败：" + bucket + "/" + item.objectKey + (hint ? "\n" + hint : ""));
    }
    uploaded += 1;
  }
  return { planned, uploaded, skipped };
}
