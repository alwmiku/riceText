/**
 * 一次性迁移：把已存文档里的章节标题层级归一化成「H1 = 章节」。
 *
 * 背景：历史文档用 `level: 2 + chapterStart: true` 标注章节。层级规则改成
 * 「只有 H1 分章」之后，读取路径（`repairDocumentForRead`）已经会做实时归一化，
 * 所以**目录不会丢**；跑这个脚本只是为了把库里存的内容也改干净，让版式、比对与
 * 编辑器之间不再存在两种写法。
 *
 * 变换规则（与 packages/document-core 的 normalizeChapterHeadings 一致）：
 * - 带 `chapterStart` 的标题 → `level: 1`（属性顺序保持 level 在前）；
 * - 其它标题按「相对章节标题的深度」下移一级：H1 书名 → H2、原 H2 → H3，
 *   深于 H4 收敛到 H4，并写入显式 `chapterStart: false`。
 *
 * 只改 `document_revisions.content_json`（修订本该不可变，这里是层级迁移的例外），
 * 不新增修订、不动 `documents.current_revision`。幂等，可重复执行。
 *
 * 用法：
 *   pnpm.cmd db:migrate-chapters -- --d1                       # 本地 D1（apps/worker/.wrangler/state）
 *   pnpm.cmd db:migrate-chapters -- --d1 --dry-run             # 只看会改哪些文档
 *   pnpm.cmd db:migrate-chapters -- --sqlite .data/ricetext.sqlite
 */
import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

const root = resolve(import.meta.dirname, "..");
const dryRun = process.argv.includes("--dry-run");
const sqlitePath = argument("--sqlite");

/** 与 normalizeChapterHeadings 一致的层级映射，用 SQL 的 json_* 函数表达。 */
const NORMALIZE_SQL = `(
  WITH heading_positions AS (
    SELECT key AS position, value AS node FROM json_each(content_json, '$.content')
  ),
  chapter_level AS (
    SELECT COALESCE(MIN(json_extract(node, '$.attrs.level')), 1) AS level
    FROM heading_positions
    WHERE json_extract(node, '$.type') = 'heading'
      AND json_extract(node, '$.attrs.chapterStart') = 1
  ),
  rewritten AS (
    SELECT
      position,
      CASE
        WHEN json_extract(node, '$.type') <> 'heading' THEN node
        WHEN json_extract(node, '$.attrs.chapterStart') = 1 THEN
          json_set(node, '$.attrs', json_object(
            'level', 1,
            'chapterStart', json('true'),
            'textAlign', json_extract(node, '$.attrs.textAlign'),
            'firstLineIndent', json_extract(node, '$.attrs.firstLineIndent'),
            'leftIndent', json_extract(node, '$.attrs.leftIndent')
          ))
        ELSE
          json_set(node, '$.attrs', json_object(
            'level', MIN(2 + MAX(0, json_extract(node, '$.attrs.level') - (SELECT level FROM chapter_level)), 4),
            'chapterStart', json('false'),
            'textAlign', json_extract(node, '$.attrs.textAlign'),
            'firstLineIndent', json_extract(node, '$.attrs.firstLineIndent'),
            'leftIndent', json_extract(node, '$.attrs.leftIndent')
          ))
      END AS node
    FROM heading_positions
  )
  SELECT json_set(
    content_json,
    '$.content',
    json_group_array(json(node) ORDER BY position)
  )
  FROM rewritten
)`;

function migrateSqlite(path: string): void {
  if (!existsSync(path)) throw new Error("找不到数据库：" + path);
  const db = new DatabaseSync(path);
  try {
    const rows = db
      .prepare(
        "SELECT r.document_id, r.revision, r.content_json FROM document_revisions r " +
          "JOIN documents d ON d.id = r.document_id AND d.current_revision = r.revision",
      )
      .all() as Array<{ document_id: string; revision: number; content_json: string }>;
    let changed = 0;
    for (const row of rows) {
      const next = db.prepare("SELECT " + NORMALIZE_SQL + " AS content").get() as {
        content: string;
      };
      if (next.content === row.content_json) continue;
      changed += 1;
      console.log(
        (dryRun ? "[dry-run] " : "") +
          row.document_id +
          " rev " +
          row.revision +
          "：章节标题层级已归一化",
      );
      if (!dryRun) {
        db.prepare(
          "UPDATE document_revisions SET content_json = ? WHERE document_id = ? AND revision = ?",
        ).run(next.content, row.document_id, row.revision);
      }
    }
    console.log("SQLite 迁移完成：扫描 " + rows.length + " 个当前修订，改写 " + changed + " 个。");
  } finally {
    db.close();
  }
}

/** 本地 D1 走 wrangler：D1 的 SQLite 文件被 miniflare 持有，不能直接打开。 */
function migrateD1(): void {
  const wrangler = resolve(root, "apps/worker/node_modules/wrangler/bin/wrangler.js");
  if (!existsSync(wrangler)) throw new Error("找不到 wrangler CLI：" + wrangler);
  const statement =
    "UPDATE document_revisions SET content_json = " +
    NORMALIZE_SQL +
    " WHERE (document_id, revision) IN " +
    "(SELECT d.id, d.current_revision FROM documents d) AND content_json <> " +
    NORMALIZE_SQL +
    "; SELECT changes() AS changed;";
  console.log(dryRun ? "[dry-run] 只统计会被改写的行数" : "开始改写本地 D1 的当前修订…");
  const result = spawnSync(
    process.execPath,
    [
      wrangler,
      "d1",
      "execute",
      "ricetext-development",
      "--local",
      "--json",
      "--command",
      dryRun
        ? "SELECT COUNT(*) AS changed FROM document_revisions r JOIN documents d " +
          "ON d.id = r.document_id AND d.current_revision = r.revision " +
          "WHERE r.content_json <> " +
          NORMALIZE_SQL +
          ";"
        : statement,
    ],
    { cwd: resolve(root, "apps/worker"), encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] },
  );
  if (result.status !== 0) throw new Error("wrangler d1 execute 失败");
  console.log(result.stdout.trim());
}

if (process.argv.includes("--d1")) migrateD1();
else migrateSqlite(sqlitePath ?? resolve(root, ".data/ricetext.sqlite"));
