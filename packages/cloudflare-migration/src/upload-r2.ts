import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

type Manifest = {
  items: Array<{
    localPath: string;
    objectKey: string;
    checksum: string | null;
    state: "ready" | "failed";
  }>;
};

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error("Missing required argument " + name);
  return value;
}

// R2 迁移采用“本地校验 -> 上传 -> 远端回读校验”，只成功上传不代表迁移完成。
const manifestPath = resolve(argument("--manifest"));
const bucket = argument("--bucket");
const dryRun = process.argv.includes("--dry-run");
const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as Manifest;
let planned = 0;
let uploaded = 0;
let verified = 0;
let skipped = 0;

for (const item of manifest.items) {
  if (item.state !== "ready" || !item.checksum) {
    skipped += 1;
    continue;
  }
  const bytes = await readFile(item.localPath);
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== item.checksum) {
    throw new Error("Checksum changed after export: " + item.localPath);
  }
  const objectPath = bucket + "/" + item.objectKey;
  if (dryRun) {
    console.log("DRY RUN: " + objectPath + " <- " + item.localPath);
    planned += 1;
    continue;
  }
  const pnpmCli = process.env.npm_execpath;
  const command = pnpmCli ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const pnpmArgs = [
      "--filter",
      "@ricetext/worker",
      "exec",
      "wrangler",
      "r2",
      "object",
      "put",
      objectPath,
      "--file",
      item.localPath,
      "--remote",
    ];
  const result = spawnSync(command, pnpmCli ? [pnpmCli, ...pnpmArgs] : pnpmArgs, {
    stdio: "inherit",
    shell: !pnpmCli && process.platform === "win32",
  });
  if (result.status !== 0) {
    throw new Error("R2 upload failed for " + objectPath);
  }
  uploaded += 1;

  // Wrangler 暂无直接返回对象 SHA-256 的稳定接口，因此回读临时文件后重新计算。
  const temporary = await mkdtemp(join(tmpdir(), "ricetext-r2-verify-"));
  const downloaded = join(temporary, "object");
  try {
    const verificationArgs = [
        "--filter",
        "@ricetext/worker",
        "exec",
        "wrangler",
        "r2",
        "object",
        "get",
        objectPath,
        "--file",
        downloaded,
        "--remote",
      ];
    const verification = spawnSync(
      command,
      pnpmCli ? [pnpmCli, ...verificationArgs] : verificationArgs,
      { stdio: "inherit", shell: !pnpmCli && process.platform === "win32" },
    );
    if (verification.status !== 0) {
      throw new Error("R2 verification download failed for " + objectPath);
    }
    const remoteChecksum = createHash("sha256")
      .update(await readFile(downloaded))
      .digest("hex");
    if (remoteChecksum !== item.checksum) {
      throw new Error("R2 checksum mismatch after upload: " + objectPath);
    }
    verified += 1;
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

const report = { bucket, planned, uploaded, verified, skipped, dryRun };
if (!dryRun) {
  await writeFile(
    join(dirname(manifestPath), "verification-r2-target.json"),
    JSON.stringify(report, null, 2) + "\n",
    "utf8",
  );
}
console.log(JSON.stringify(report, null, 2));
