import { DatabaseSync } from "node:sqlite";
import { resolve } from "node:path";

function argument(name: string, fallback?: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const databasePath = resolve(argument("--sqlite", ".data/ricetext.sqlite")!);
const selectedDocument = argument("--document");
const from = Number(argument("--from", "0"));
const limit = Number(argument("--limit", "30"));
if (!Number.isSafeInteger(from) || from < 0) throw new Error("--from 必须是非负整数");
if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
  throw new Error("--limit 必须是 1 到 500 的整数");
}

const db = new DatabaseSync(databasePath, { readOnly: true });
try {
  const documents = db
    .prepare(
      "SELECT d.id, d.title, COUNT(c.id) AS chapter_count, " +
        "MIN(c.sort_order) AS min_order, MAX(c.sort_order) AS max_order, " +
        "SUM(CASE WHEN c.id IS NOT NULL AND c.id NOT GLOB 'chapter-v1-[0-9a-f]*' " +
        "AND c.id NOT GLOB 'chapter-[0-9]*' THEN 1 ELSE 0 END) AS unusual_ids " +
        "FROM documents d LEFT JOIN chapters c ON c.document_id = d.id " +
        "GROUP BY d.id ORDER BY d.updated_at DESC",
    )
    .all() as Array<{
    id: string;
    title: string;
    chapter_count: number;
    min_order: number | null;
    max_order: number | null;
    unusual_ids: number;
  }>;

  const summaries = documents.map((document) => {
    const gaps = db
      .prepare(
        "SELECT COUNT(*) AS count FROM (" +
          "SELECT sort_order, LAG(sort_order) OVER (ORDER BY sort_order) AS previous " +
          "FROM chapters WHERE document_id = ?" +
          ") WHERE previous IS NOT NULL AND sort_order <> previous + 1",
      )
      .get(document.id) as { count: number };
    const startsAtZero = document.chapter_count === 0 || document.min_order === 0;
    const contiguous =
      document.chapter_count === 0 ||
      (startsAtZero &&
        gaps.count === 0 &&
        document.max_order === document.chapter_count - 1);
    return {
      article_id: document.id,
      title: document.title,
      chapters: document.chapter_count,
      order_range:
        document.chapter_count === 0
          ? "-"
          : `${document.min_order}..${document.max_order}`,
      order_gaps: gaps.count,
      unusual_ids: document.unusual_ids,
      result: contiguous ? "正确" : "顺序异常",
    };
  });

  console.log(`数据库：${databasePath}`);
  console.table(summaries);

  if (selectedDocument) {
    const rows = db
      .prepare(
        "SELECT sort_order AS chapter_order, title, id, revision, " +
          "substr(content_hash, 1, 12) AS content_hash " +
          "FROM chapters WHERE document_id = ? AND sort_order >= ? " +
          "ORDER BY sort_order LIMIT ?",
      )
      .all(selectedDocument, from, limit);
    console.table(rows);
  }
} finally {
  db.close();
}
