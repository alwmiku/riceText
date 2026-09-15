// 站点表情的对象键是与 Worker 读取路径、部署上传脚本之间的隐式契约：
// 键写错时本地看不出来（本地桶里恰好有同名对象），线上才会 404。
// 这里用真实仓库目录锁定「键 = emoji/<原始文件名>、缩略图在 thumbs/ 下」。
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { CUSTOM_EMOJI_ENTRIES, emojiThumbnailFileName } from "@ricetext/contracts";
import { collectEmojiAssets, uploadR2Manifest, verifyManifestItem } from "./r2-assets.js";

// 根 vitest 跑在 jsdom 里，jsdom 的 URL 不接受相对路径，因此用路径拼接定位仓库目录。
const assetsRoot = resolve(import.meta.dirname, "..", "..", "..", "assets", "emoji");
const exportedAt = "2026-09-02T00:00:00.000Z";

it("为每个自定义表情生成 emoji/<文件名> 对象键", () => {
  const manifest = collectEmojiAssets(assetsRoot, exportedAt);
  expect(manifest.exportedAt).toBe(exportedAt);
  const keys = manifest.items.map((item) => item.objectKey);
  for (const entry of CUSTOM_EMOJI_ENTRIES) {
    expect(keys).toContain("emoji/" + entry.assetFile);
  }
  // 键必须唯一，否则后上传的对象会静默覆盖前一个。
  expect(new Set(keys).size).toBe(keys.length);
  expect(manifest.items.every((item) => item.state === "ready" && item.byteSize > 0)).toBe(true);
});

it("动图的缩略图键落在 thumbs/ 下且与目录同名", () => {
  const manifest = collectEmojiAssets(assetsRoot, exportedAt);
  const keys = new Set(manifest.items.map((item) => item.objectKey));
  for (const entry of CUSTOM_EMOJI_ENTRIES) {
    const thumbnail = emojiThumbnailFileName(entry.id);
    if (!thumbnail) continue;
    expect(keys).toContain("emoji/thumbs/" + thumbnail);
  }
});

it("校验和与磁盘内容一致，manifest 被篡改时拒绝上传", () => {
  const manifest = collectEmojiAssets(assetsRoot, exportedAt);
  const first = manifest.items[0]!;
  expect(() => verifyManifestItem(first)).not.toThrow();
  expect(() => verifyManifestItem({ ...first, checksum: "0".repeat(64) })).toThrow(
    /Checksum changed/u,
  );
});

it("跳过 state 非 ready 或缺少 checksum 的条目", () => {
  const manifest = collectEmojiAssets(assetsRoot, exportedAt);
  const visited: string[] = [];
  const report = uploadR2Manifest({
    manifest: { ...manifest, items: [{ ...manifest.items[0]!, state: "failed" }] },
    bucket: "bucket",
    local: true,
    runner: (args) => {
      visited.push(args.join(" "));
      return { status: 0, output: "" };
    },
  });
  expect(report).toEqual({ planned: 0, uploaded: 0, skipped: 1 });
  expect(visited).toEqual([]);
});

it("上传失败时重试到 attempts 上限并抛错", () => {
  const manifest = collectEmojiAssets(assetsRoot, exportedAt);
  const item = manifest.items[0]!;
  let calls = 0;
  expect(() =>
    uploadR2Manifest({
      manifest: { ...manifest, items: [item] },
      bucket: "bucket",
      local: false,
      attempts: 3,
      runner: () => {
        calls += 1;
        return { status: 1, output: "boom" };
      },
    }),
  ).toThrow(/R2 上传失败/u);
  expect(calls).toBe(3);
});

it("上传内容与 manifest 记录的校验和一致", () => {
  const manifest = collectEmojiAssets(assetsRoot, exportedAt);
  const item = manifest.items.find(
    (entry) => entry.objectKey === "emoji/" + CUSTOM_EMOJI_ENTRIES[0]!.assetFile,
  )!;
  const expected = createHash("sha256")
    .update(readFileSync(join(assetsRoot, String(CUSTOM_EMOJI_ENTRIES[0]!.assetFile))))
    .digest("hex");
  expect(item.checksum).toBe(expected);
});
