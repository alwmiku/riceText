/**
 * 打包本地数据，便于复制到另一台机器（或备份）。
 *
 * 两类库都要处理：
 * - Node API：`.data/ricetext.sqlite` 处于 WAL 模式，**数据往往还在 -wal 里**。
 *   只拷主文件会得到一个空库（实测 4096B、0 张表）。这里先
 *   `PRAGMA wal_checkpoint(TRUNCATE)` 把 WAL 落盘，再连同 `-wal`/`-shm` 一起快照，
 *   并把 `.data/uploads` 一并带上。
 * - Worker D1：不直接拷 `.wrangler` 内部的 hash 文件，而是导出成 SQL（见
 *   `--d1-sql`），在目标机用 `wrangler d1 execute --local --file` 回灌；这条路径
 *   与机器/路径无关，也不受 WAL 影响。
 *
 * 用法：
 *   pnpm.cmd db:pack                                  # 打 Node 侧数据到 .data/transfer
 *   pnpm.cmd db:pack -- --out D:\share\ricetext-data   # 指定输出目录
 *   pnpm.cmd db:pack -- --d1-sql .data/transfer/d1.sql # 额外导出本地 D1 的 SQL
 */
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

const root = resolve(import.meta.dirname, "..");
const dataDirectory = resolve(root, ".data");
const databasePath = resolve(dataDirectory, "ricetext.sqlite");
const uploadsDirectory = resolve(dataDirectory, "uploads");
const outputDirectory = resolve(argument("--out") ?? resolve(dataDirectory, "transfer"));
const d1Sql = argument("--d1-sql");

/** WAL 里可能有未落盘的数据，快照前必须先 checkpoint。 */
function checkpointWAL(path: string): void {
  const database = new DatabaseSync(path);
  try {
    database.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  } finally {
    database.close();
  }
}

function sha256(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

interface PackedFile {
  file: string;
  bytes: number;
  sha256: string;
}

/** 递归复制目录，并记录每个文件的校验和。 */
function copyTree(source: string, target: string): PackedFile[] {
  const packed: PackedFile[] = [];
  for (const name of readdirSync(source)) {
    const from = join(source, name);
    const to = join(target, name);
    if (statSync(from).isDirectory()) {
      mkdirSync(to, { recursive: true });
      packed.push(...copyTree(from, to));
      continue;
    }
    copyFileSync(from, to);
    packed.push({
      file: to.slice(outputDirectory.length + 1).replaceAll("\\", "/"),
      bytes: statSync(to).size,
      sha256: sha256(to),
    });
  }
  return packed;
}

if (!existsSync(databasePath)) {
  throw new Error("找不到 " + databasePath + "；先启动一次 API 让它初始化数据库");
}
mkdirSync(outputDirectory, { recursive: true });

checkpointWAL(databasePath);

const packed: PackedFile[] = [];
// 三件套一起拷：即使目标机没有 sqlite，也能原样恢复。
for (const suffix of ["", "-wal", "-shm"]) {
  const source = databasePath + suffix;
  if (!existsSync(source)) continue;
  const target = join(outputDirectory, basename(source));
  copyFileSync(source, target);
  packed.push({ file: basename(target), bytes: statSync(target).size, sha256: sha256(target) });
}

if (existsSync(uploadsDirectory)) {
  mkdirSync(join(outputDirectory, "uploads"), { recursive: true });
  packed.push(...copyTree(uploadsDirectory, join(outputDirectory, "uploads")));
}

// 数据库里若引用了不存在的上传文件，两边都会是坏数据：打包时直接报错。
const database = new DatabaseSync(join(outputDirectory, "ricetext.sqlite"));
const missing: string[] = [];
for (const row of database.prepare("SELECT stored_name FROM assets").all() as Array<{
  stored_name: string;
}>) {
  if (!existsSync(join(outputDirectory, "uploads", row.stored_name))) missing.push(row.stored_name);
}
const counts = database
  .prepare(
    "SELECT (SELECT count(*) FROM documents) AS documents, (SELECT count(*) FROM users) AS users, (SELECT count(*) FROM assets) AS assets",
  )
  .get() as { documents: number; users: number; assets: number };
database.close();
if (missing.length > 0) {
  throw new Error(
    "有 " +
      String(missing.length) +
      " 个上传文件缺失，先补齐再打包：" +
      missing.slice(0, 5).join(", "),
  );
}

writeFileSync(
  join(outputDirectory, "manifest.json"),
  JSON.stringify(
    {
      packedAt: new Date().toISOString(),
      source: { databasePath, uploadsDirectory },
      counts,
      files: packed.length,
      entries: packed,
    },
    null,
    2,
  ) + "\n",
);

console.log("已打包到 " + outputDirectory);
console.log(
  "  文章 " +
    String(counts.documents) +
    " · 用户 " +
    String(counts.users) +
    " · 上传 " +
    String(counts.assets) +
    " · 文件 " +
    String(packed.length),
);
console.log("  清单 " + join(outputDirectory, "manifest.json"));

if (d1Sql) {
  // 与 packages/cloudflare-migration 的调用方式一致：pnpm 环境里用同版本的
  // wrangler CLI，直接 spawn pnpm 会因为 `--` 丢失参数（ERR_UNKNOWN_FILE_EXTENSION）。
  // wrangler 是 worker 包的依赖，装在它自己的 node_modules 下。
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
    throw new Error("找不到 wrangler CLI：" + wranglerCli + "；先 pnpm install");
  }
  const result = (await import("node:child_process")).spawnSync(
    process.execPath,
    [wranglerCli, "d1", "export", "DB", "--local", "--output", resolve(d1Sql)],
    { stdio: "inherit", cwd: resolve(root, "apps", "worker") },
  );
  if (result.status !== 0) throw new Error("本地 D1 导出失败");
  console.log("  本地 D1 已导出到 " + resolve(d1Sql));
}
