/**
 * 一次性迁移：把已存文档里的章节标题层级归一化成「H1 = 章节」。
 *
 * 背景：历史文档用 `level: 2 + chapterStart: true` 标注章节。层级规则改成
 * 「只有 H1 分章」之后，读取路径（`repairDocumentForRead`）已经会做实时归一化，
 * 所以**目录不会丢**；跑这个脚本只是为了把库里存的内容也改干净，让编辑器、版式与
 * 版本比对之间不再存在两种写法。
 *
 * 变换由 `normalizeChapterHeadings()`（packages/document-core）完成——**不重写一份
 * SQL 版本**：章节标记的判定（`chapterStart === true`）与深度映射很容易在 SQL 里
 * 写成另一套语义（实测就会把章节标题降级、丢掉标记），因此只做「读 → 归一化 → 写」。
 *
 * 只改 `document_revisions.content_json` 里**当前修订**的那一行（修订本该不可变，
 * 这里是层级迁移的例外），不新增修订、不动 `documents.current_revision`。幂等。
 *
 * 用法：
 *   pnpm.cmd db:migrate-chapters                      # Node API 库 .data/ricetext.sqlite
 *   pnpm.cmd db:migrate-chapters -- --sqlite <path>   # 指定 SQLite 库
 *   pnpm.cmd db:migrate-chapters -- --d1              # 本地 D1（wrangler 模拟）
 *   pnpm.cmd db:migrate-chapters -- --d1 --remote     # 远端 D1（默认 production）
 *   pnpm.cmd db:migrate-chapters -- --d1 --remote --env preview
 *   ……追加 `--dry-run` 只统计会改几行
 *
 * 远端需要凭据：`CLOUDFLARE_API_TOKEN`（+ `CLOUDFLARE_ACCOUNT_ID`），或在已登录的
 * 终端里跑。默认只动本地，必须显式加 `--remote` 才会写远端库。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { normalizeChapterHeadings, type JSONContent } from "../packages/document-core/src/index.js";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

interface StoredRevision {
  documentId: string;
  revision: number;
  content: JSONContent;
}

interface Store {
  label: string;
  read(): StoredRevision[];
  write(row: StoredRevision, next: JSONContent): void;
}

/**
 * SQL 字符串字面量。
 *
 * 只用于「写回」：写入前的 JSON 已由编辑器/服务端净化过一次（普通 JSON，没有
 * NUL 或代理对残缺），这里仍然显式处理单引号，避免拼接出无效语句。
 */
function sqlLiteral(value: string): string {
  return "'" + value.replace(/'/gu, "''") + "'";
}

const root = resolve(import.meta.dirname, "..");

/** Node API 的 SQLite 库。 */
function sqliteStore(path: string): Store {
  if (!existsSync(path)) throw new Error("找不到数据库：" + path);
  const db = new DatabaseSync(path);
  return {
    label: "SQLite " + path,
    read() {
      const rows = db
        .prepare(
          "SELECT r.document_id, r.revision, r.content_json FROM document_revisions r " +
            "JOIN documents d ON d.id = r.document_id AND d.current_revision = r.revision",
        )
        .all() as Array<{ document_id: string; revision: number; content_json: string }>;
      return rows.map((row) => ({
        documentId: row.document_id,
        revision: row.revision,
        content: JSON.parse(row.content_json) as JSONContent,
      }));
    },
    write(row, next) {
      db.prepare(
        "UPDATE document_revisions SET content_json = ? WHERE document_id = ? AND revision = ?",
      ).run(JSON.stringify(next), row.documentId, row.revision);
    },
  };
}

/** D1：库文件被 miniflare（或远端服务）持有，只能通过 wrangler 读写。 */
function d1Store(remote: boolean, database: string): Store {
  const wrangler = resolve(root, "apps/worker/node_modules/wrangler/bin/wrangler.js");
  if (!existsSync(wrangler)) throw new Error("找不到 wrangler CLI：" + wrangler);
  const run = (sql: string): string => {
    const result = spawnSync(
      process.execPath,
      [
        wrangler,
        "d1",
        "execute",
        database,
        ...(remote ? ["--remote"] : ["--local"]),
        "--json",
        "--command",
        sql,
      ],
      { cwd: resolve(root, "apps/worker"), encoding: "utf8" },
    );
    if (result.status !== 0) {
      // 去掉 wrangler 输出里的 ANSI 颜色码，只留可读的错误正文。
      const plain = String(result.stderr ?? "").replaceAll(String.fromCharCode(27), "");
      throw new Error("wrangler d1 execute 失败：" + plain.slice(-400));
    }
    return result.stdout;
  };
  return {
    label: (remote ? "远端 D1 " : "本地 D1 ") + database,
    read() {
      const parsed = JSON.parse(
        run(
          "SELECT r.document_id, r.revision, r.content_json FROM document_revisions r " +
            "JOIN documents d ON d.id = r.document_id AND d.current_revision = r.revision;",
        ),
      ) as Array<{
        results: Array<{ document_id: string; revision: number; content_json: string }>;
      }>;
      return (parsed[0]?.results ?? []).map((row) => ({
        documentId: row.document_id,
        revision: row.revision,
        content: JSON.parse(row.content_json) as JSONContent,
      }));
    },
    write(row, next) {
      // 带上原内容做条件：并发写入后不会用旧快照覆盖新修订。
      run(
        "UPDATE document_revisions SET content_json = " +
          sqlLiteral(JSON.stringify(next)) +
          " WHERE document_id = " +
          sqlLiteral(row.documentId) +
          " AND revision = " +
          String(row.revision) +
          " AND content_json = " +
          sqlLiteral(JSON.stringify(row.content)) +
          ";",
      );
    },
  };
}

const dryRun = process.argv.includes("--dry-run");
const useD1 = process.argv.includes("--d1");
const remote = process.argv.includes("--remote");
const environment = argument("--env") ?? "production";
const store = useD1
  ? d1Store(remote, remote ? "ricetext-" + environment : "ricetext-development")
  : sqliteStore(argument("--sqlite") ?? resolve(root, ".data/ricetext.sqlite"));

console.log((dryRun ? "[dry-run] 只统计会被改写的文档：" : "开始改写当前修订：") + store.label);
const rows = store.read();
let changed = 0;
for (const row of rows) {
  const next = normalizeChapterHeadings(row.content);
  if (JSON.stringify(next) === JSON.stringify(row.content)) continue;
  changed += 1;
  const chapters = (next.content ?? []).filter(
    (node) => node.type === "heading" && node.attrs?.chapterStart === true,
  ).length;
  console.log(
    (dryRun ? "[dry-run] " : "") +
      row.documentId +
      " rev " +
      row.revision +
      "：章节标题 " +
      chapters +
      " 个，层级已归一化",
  );
  if (!dryRun) store.write(row, next);
}
console.log("迁移完成：扫描 " + rows.length + " 个当前修订，改写 " + changed + " 个。");
