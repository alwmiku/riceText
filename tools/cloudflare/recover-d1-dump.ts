// 从一份 D1 全量转储（.data/*.sql）里把指定文章重新抽出来，生成可导入的 SQL。
//
// 用途只有一个：本地 D1 被误清空或误覆盖时抢救真实创作数据。
// 转储是纯 SQL 文本，因此这个过程不依赖任何数据库连接，也不需要原来的 schema 版本。
//
// 用法：
//   pnpm.cmd db:recover-dump -- --source .data/d1-local.sql --documents article_xxx,article_yyy
//   # 检查输出后再导入：确认列与当前 D1 schema 一致、没有混进演示文章
//   pnpm.cmd --filter @ricetext/worker exec wrangler d1 execute DB --local \
//     --persist-to ../../apps/worker/.wrangler/state --file ../../.data/recovered/recover.sql
//
// 注意：只按文档 ID 精确匹配，不会顺带导入 demo-post 之类的演示数据；导入前先备份目标状态目录。
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, resolve } from "node:path";

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const source = resolve(argument("--source", ".data/d1-local.sql")!);
const output = resolve(argument("--out", ".data/recovered/recover.sql")!);
const documentIds = (argument("--documents", "") ?? "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

if (!existsSync(source)) throw new Error("找不到转储文件：" + source);
if (documentIds.length === 0) {
  throw new Error("必须用 --documents 指定要抢救的文章 ID（逗号分隔），避免误导入演示数据");
}
for (const id of documentIds) {
  // 文档 ID 直接拼进匹配串，先拒绝可疑字符，避免把转储里的其他内容一并带走。
  if (!/^[A-Za-z0-9_-]+$/u.test(id)) throw new Error("文章 ID 含非法字符：" + id);
}

/** 输出文件的行分隔符；显式声明避免手写转义。 */
const NEWLINE = String.fromCharCode(10);

/** 转储里除 INSERT 之外还有 PRAGMA/BEGIN/COMMIT 与 schema 语句，这里只保留数据行。 */
function isDataStatement(line: string): boolean {
  return /^INSERT(?: OR [A-Z]+)? INTO "/u.test(line);
}

const statements: string[] = [];
const tables = new Set<string>();
const readable = createInterface({
  input: createReadStream(source, { encoding: "utf8" }),
  crlfDelay: Infinity,
});
for await (const line of readable) {
  if (!isDataStatement(line)) continue;
  // 每条 INSERT 独占一行；正文里的换行被 SQL 引号包住，不会拆行。
  if (!documentIds.some((id) => line.includes("'" + id + "'"))) continue;
  const table = /^INSERT(?: OR [A-Z]+)? INTO "([a-z_]+)"/u.exec(line)?.[1];
  if (table) tables.add(table);
  statements.push(line.trim().endsWith(";") ? line.trim() : line.trim() + ";");
}

if (statements.length === 0) {
  throw new Error("转储里没有匹配任何文章：" + documentIds.join(", "));
}
mkdirSync(dirname(output), { recursive: true });
writeFileSync(
  output,
  // 章节/修订之间有外键，导入期间先推迟检查，和 wrangler 导出的转储保持一致。
  [`PRAGMA defer_foreign_keys=TRUE;`, ...statements, ``].join(NEWLINE),
  "utf8",
);
console.log(
  JSON.stringify(
    {
      source,
      output,
      documents: documentIds,
      statements: statements.length,
      bytes: statSync(output).size,
      tables: [...tables].sort(),
    },
    null,
    2,
  ),
);
