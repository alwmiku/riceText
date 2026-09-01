import { DatabaseSync } from "node:sqlite";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

/** API 数据库初始化选项。 */
export interface DatabaseOptions {
  /** SQLite 文件路径；`:memory:` 用于快速单元测试。 */
  path: string;
  /** 是否写入幂等实时数据，默认 true。 */
  seed?: boolean;
}

/** 首版完整关系模型；既有 migration 内容不可改写，后续变更应追加新版本。 */
const migrationV1 = `
CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('author', 'reader', 'moderator')),
  is_friend INTEGER NOT NULL DEFAULT 0 CHECK (is_friend IN (0, 1)),
  bio TEXT NOT NULL DEFAULT ''
);

CREATE TABLE documents (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  schema_version INTEGER NOT NULL,
  current_revision INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE document_revisions (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL CHECK (operation IN ('seed', 'update', 'rollback', 'suggestion')),
  target_revision INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, revision)
);

CREATE TABLE document_mutations (
  document_id TEXT NOT NULL,
  client_mutation_id TEXT NOT NULL,
  request_json TEXT NOT NULL,
  revision INTEGER NOT NULL,
  PRIMARY KEY (document_id, client_mutation_id),
  FOREIGN KEY (document_id, revision) REFERENCES document_revisions(document_id, revision)
);

CREATE TABLE assets (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE dice_rolls (
  id TEXT PRIMARY KEY,
  root_roll_id TEXT NOT NULL,
  previous_roll_id TEXT REFERENCES dice_rolls(id),
  expression TEXT NOT NULL,
  details_json TEXT NOT NULL,
  total REAL NOT NULL,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL
);

CREATE TABLE comment_threads (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  anchor_id TEXT NOT NULL,
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, anchor_id)
);

CREATE TABLE comment_replies (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  anchor_id TEXT NOT NULL,
  parent_id TEXT REFERENCES comment_replies(id) ON DELETE CASCADE,
  author_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id, anchor_id) REFERENCES comment_threads(document_id, anchor_id)
);

CREATE INDEX comment_replies_thread_idx ON comment_replies(document_id, anchor_id, created_at DESC);

CREATE TABLE comment_votes (
  reply_id TEXT NOT NULL REFERENCES comment_replies(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  value INTEGER NOT NULL CHECK (value IN (-1, 1)),
  created_at TEXT NOT NULL,
  PRIMARY KEY (reply_id, user_id)
);

CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  sort_order INTEGER NOT NULL,
  document_id TEXT NOT NULL REFERENCES documents(id)
);

CREATE TABLE suggestions (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  from_text TEXT NOT NULL,
  to_text TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  author_id TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);

CREATE TABLE reply_gates (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  content_json TEXT NOT NULL
);

CREATE TABLE reply_receipts (
  document_id TEXT NOT NULL REFERENCES documents(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, user_id)
);

CREATE TABLE wallets (
  user_id TEXT PRIMARY KEY REFERENCES users(id),
  balance INTEGER NOT NULL
);

CREATE TABLE attachments (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  price INTEGER NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  download_url TEXT NOT NULL
);

CREATE TABLE attachment_purchases (
  attachment_id TEXT NOT NULL REFERENCES attachments(id),
  buyer_id TEXT NOT NULL REFERENCES users(id),
  price INTEGER NOT NULL,
  author_income INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (attachment_id, buyer_id)
);

CREATE TABLE polls (
  id TEXT PRIMARY KEY,
  question TEXT NOT NULL,
  multiple INTEGER NOT NULL CHECK (multiple IN (0, 1)),
  minimum_role TEXT NOT NULL
);

CREATE TABLE poll_options (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

CREATE TABLE poll_votes (
  id TEXT PRIMARY KEY,
  poll_id TEXT NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (poll_id, user_id)
);

CREATE TABLE poll_vote_options (
  vote_id TEXT NOT NULL REFERENCES poll_votes(id) ON DELETE CASCADE,
  option_id TEXT NOT NULL REFERENCES poll_options(id),
  PRIMARY KEY (vote_id, option_id)
);
`;

/** 与章节目录一致的五章规范种子文档。 */
const seedDocument = {
  type: "doc" as const,
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "雾港来信" }] },
    { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "楔子 雨季之前" }] },
    { type: "paragraph", content: [{ type: "text", text: "雨季开始前的第七天，港口送走了最后一班客船。雾线从海面爬上来，把整条长街泡得发软。" }] },
    { type: "paragraph", content: [{ type: "text", text: "邮差在码头边捡到一封没有署名、也没有邮票的信。信封被雨水浸透，只留下一个模糊的地址：灯塔脚下，第三扇窗。" }] },
    { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "第一章 潮汐表" }] },
    { type: "paragraph", content: [{ type: "text", text: "潮声沿着旧城墙漫上来，旅人把未寄出的信压在灯下。" }, { type: "inlineCommentAnchor", attrs: { threadId: "anchor-opening", count: 2, placement: "end" } }] },
    { type: "paragraph", content: [{ type: "text", text: "灯塔管理员翻着泛黄的潮汐表说，今夜没有雾，却有风。船不该出港的，可船还是出了。" }] },
    { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "第二章 陌生船票" }] },
    { type: "paragraph", content: [{ type: "text", text: "他在抽屉底层找到一张陌生的船票。日期是明天，航线却早已停运多年。票根背面用铅笔写着：如果你看到这封信，请把它送回钟楼。" }] },
    { type: "paragraph", content: [{ type: "text", text: "调查检定 " }, { type: "diceRoll", attrs: { rollId: "roll_seed", expression: "3d5", rolls: [4, 3, 5], total: 12, rerollOf: null } }, { type: "text", text: "，线索足够。" }] },
    { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "第三章 没有寄件人的信" }] },
    { type: "novelExcerpt", attrs: { variant: "desktop-book", bookTitle: "雾港来信", chapterTitle: "第三章 没有寄件人的信", author: "林见", sourceUrl: "https://example.com/books/mist-harbor" }, content: [{ type: "paragraph", content: [{ type: "text", text: "如果明天仍有雾，就沿着钟声的方向走。" }] }] },
    { type: "paragraph", content: [{ type: "text", text: "第三扇窗的窗台积着薄灰，玻璃内侧贴着一封没有寄件人的信。这一句包含结局线索，请谨慎查看。", marks: [{ type: "spoiler" }] }] },
    { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "第四章 待发布" }] },
    { type: "paragraph", content: [{ type: "text", text: "这一章还躺在作者的抽屉里，只有一张潮汐表的复印件，和一句没来得及写下的开头。" }] },
    { type: "replyGate", attrs: { gateId: "gate-bonus", prompt: "回复后查看番外片段" }, content: [{ type: "paragraph", content: [{ type: "text", text: "番外内容由服务端权限投影。" }] }] },
    { type: "attachmentRef", attrs: { attachmentId: "attachment-sample", name: "雾港设定集.txt", mimeType: "text/plain", size: 2048, priceCoins: 10 } },
    { type: "pollRef", attrs: { pollId: "poll-route", question: "下一章先去哪里？", multiple: false, options: [{ id: "poll-option-tower", label: "钟楼" }, { id: "poll-option-dock", label: "旧码头" }, { id: "poll-option-library", label: "潮汐图书馆" }] } },
  ],
};

/** 在独占事务中执行一次迁移；失败时不会记录 schema version。 */
function runMigration(db: DatabaseSync, version: number, sql: string): void {
  const row = db.prepare("SELECT version FROM schema_migrations WHERE version = ?").get(version);
  if (row) return;
  db.exec("BEGIN IMMEDIATE");
  try {
    db.exec(sql);
    db.prepare("INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)").run(version, new Date().toISOString());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 章节独立版本号：每次保存该章节时递增。 */
const migrationV2 = `
ALTER TABLE chapters ADD COLUMN revision INTEGER NOT NULL DEFAULT 1;
`;

/** 章节内容与内容哈希：支持“对比差异、最小上传”的章节同步。 */
const migrationV3 = `
ALTER TABLE chapters ADD COLUMN content_json TEXT;
ALTER TABLE chapters ADD COLUMN content_hash TEXT;
`;

/** 校订定位：建议必须指明“哪一篇文章的哪一章的哪一行”，支持按章过滤与行级 diff。 */
const migrationV4 = `
ALTER TABLE suggestions ADD COLUMN chapter_id TEXT REFERENCES chapters(id);
ALTER TABLE suggestions ADD COLUMN chapter_title TEXT NOT NULL DEFAULT '';
ALTER TABLE suggestions ADD COLUMN line_no INTEGER NOT NULL DEFAULT 0;
ALTER TABLE suggestions ADD COLUMN line_text TEXT NOT NULL DEFAULT '';
`;

/**
 * 溯源与审计：每个 revision 记录本次应用的 ProseMirror steps JSON，
 * operation 增加 'steps'（SQLite 改 CHECK 约束必须重建表）。
 * 快照（content_json）与 steps（steps_json）双记录并存：
 * 快照用于快速读取/回退，steps 用于溯源与审计展示。
 */
const migrationV5 = `
CREATE TABLE document_revisions_v5 (
  document_id TEXT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  revision INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  steps_json TEXT,
  author_id TEXT NOT NULL REFERENCES users(id),
  operation TEXT NOT NULL CHECK (operation IN ('seed', 'update', 'rollback', 'suggestion', 'steps')),
  target_revision INTEGER,
  created_at TEXT NOT NULL,
  PRIMARY KEY (document_id, revision)
);
INSERT INTO document_revisions_v5(document_id, revision, schema_version, content_json, steps_json, author_id, operation, target_revision, created_at)
  SELECT document_id, revision, schema_version, content_json, NULL, author_id, operation, target_revision, created_at FROM document_revisions;
DROP TABLE document_revisions;
ALTER TABLE document_revisions_v5 RENAME TO document_revisions;
`;

/** 每章独立记录最近一次服务器确认保存时间。 */
const migrationV7 = `
ALTER TABLE chapters ADD COLUMN updated_at TEXT;
UPDATE chapters
SET updated_at = COALESCE(
  (SELECT updated_at FROM documents WHERE documents.id = chapters.document_id),
  CURRENT_TIMESTAMP
)
WHERE updated_at IS NULL OR updated_at = '';
`;

/** 修复已执行 V7 但遗留空章节时间的数据库。 */
const migrationV8 = `
UPDATE chapters
SET updated_at = COALESCE(
  NULLIF((SELECT updated_at FROM documents WHERE documents.id = chapters.document_id), ''),
  CURRENT_TIMESTAMP
)
WHERE updated_at IS NULL OR updated_at = '';
`;

/** 从不可变文档写入记录恢复曾被旧种子逻辑清零的章节版本与时间。 */
const migrationV9 = `
UPDATE chapters
SET
  revision = MAX(
    revision,
    1 + (
      SELECT COUNT(*)
      FROM document_mutations mutation
      WHERE mutation.document_id = chapters.document_id
        AND json_valid(mutation.request_json)
        AND json_extract(mutation.request_json, '$.chapterId') = chapters.id
    )
  ),
  updated_at = COALESCE(
    (
      SELECT MAX(revision.created_at)
      FROM document_mutations mutation
      JOIN document_revisions revision
        ON revision.document_id = mutation.document_id
       AND revision.revision = mutation.revision
      WHERE mutation.document_id = chapters.document_id
        AND json_valid(mutation.request_json)
        AND json_extract(mutation.request_json, '$.chapterId') = chapters.id
    ),
    updated_at
  );
`;

/** 章节可见性：隐藏的章节读者不可读，作者写完取消隐藏后恢复可读。 */
const migrationV10 = `
ALTER TABLE chapters ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
`;

const migrationV6 = `
CREATE TABLE suggestion_batches (
  id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL REFERENCES documents(id),
  chapter_id TEXT NOT NULL,
  chapter_title TEXT NOT NULL,
  base_revision INTEGER NOT NULL,
  before_content_json TEXT NOT NULL,
  after_content_json TEXT NOT NULL,
  steps_json TEXT NOT NULL,
  reason TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
  author_id TEXT NOT NULL REFERENCES users(id),
  reviewer_id TEXT REFERENCES users(id),
  created_at TEXT NOT NULL,
  reviewed_at TEXT
);
CREATE INDEX suggestion_batches_document_idx
  ON suggestion_batches(document_id, created_at DESC);
`;

/** 幂等写入开发身份、正文和论坛初始数据，重复启动不会覆盖用户修改。 */
function seed(db: DatabaseSync): void {
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    const insertUser = db.prepare("INSERT OR IGNORE INTO users(id, name, role, is_friend, bio) VALUES (?, ?, ?, ?, ?)");
    insertUser.run("author", "林见", "author", 1, "《雾港来信》作者，负责章节与修订审核。");
    insertUser.run("reader", "小满", "reader", 1, "喜欢在段落末留下间贴的读者。");
    insertUser.run("moderator", "版务七号", "moderator", 0, "负责内容审核与版本恢复。");
    insertUser.run("wanderer", "远舟", "reader", 0, "可由服务端解析的非好友用户。");

    db.prepare("INSERT OR IGNORE INTO documents(id, title, schema_version, current_revision, created_by, created_at, updated_at) VALUES (?, ?, 1, 1, 'author', ?, ?)").run("demo-post", "雾港来信 · 第一章", now, now);
    db.prepare("INSERT OR IGNORE INTO document_revisions(document_id, revision, schema_version, content_json, author_id, operation, target_revision, created_at) VALUES (?, 1, 1, ?, 'author', 'seed', NULL, ?)").run("demo-post", JSON.stringify(seedDocument), now);

    db.prepare("INSERT OR IGNORE INTO comment_threads(document_id, anchor_id, archived, created_at) VALUES ('demo-post', 'anchor-opening', 0, ?)").run(now);
    db.prepare("INSERT OR IGNORE INTO comment_replies(id, document_id, anchor_id, parent_id, author_id, body, created_at) VALUES ('comment-root', 'demo-post', 'anchor-opening', NULL, 'reader', '这里的钟声会不会和序章呼应？', ?)").run(now);
    db.prepare("INSERT OR IGNORE INTO comment_replies(id, document_id, anchor_id, parent_id, author_id, body, created_at) VALUES ('comment-child', 'demo-post', 'anchor-opening', 'comment-root', 'author', '会在第三章解释钟楼的来历。', ?)").run(now);
    db.prepare("INSERT OR IGNORE INTO comment_votes(reply_id, user_id, value, created_at) VALUES ('comment-root', 'author', 1, ?)").run(now);

    // 章节目录只幂等同步标题与排序，绝不能在重启时清空独立版本和保存时间。
    const insertChapter = db.prepare(`
      INSERT INTO chapters(id, title, sort_order, document_id, revision, updated_at)
      VALUES (?, ?, ?, 'demo-post', 1, ?)
      ON CONFLICT(id) DO UPDATE SET
        title = excluded.title,
        sort_order = excluded.sort_order,
        document_id = excluded.document_id,
        updated_at = COALESCE(NULLIF(chapters.updated_at, ''), excluded.updated_at)
    `);
    insertChapter.run("chapter-0", "楔子 · 雨季之前", 0, now);
    insertChapter.run("chapter-1", "第一章 · 潮汐表", 1, now);
    insertChapter.run("chapter-2", "第二章 · 陌生船票", 2, now);
    insertChapter.run("chapter-3", "第三章 · 没有寄件人的信", 3, now);
    insertChapter.run("chapter-4", "第四章 · 待发布", 4, now);
    db.prepare("INSERT OR IGNORE INTO reply_gates(id, document_id, content_json) VALUES ('gate-bonus', 'demo-post', ?)").run(JSON.stringify({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "番外：邮差其实在第一封信到来前就见过旅人。" }] }] }));

    db.prepare("INSERT OR IGNORE INTO wallets(user_id, balance) VALUES ('author', 100)").run();
    db.prepare("INSERT OR IGNORE INTO wallets(user_id, balance) VALUES ('reader', 50)").run();
    db.prepare("INSERT OR IGNORE INTO wallets(user_id, balance) VALUES ('moderator', 100)").run();
    db.prepare("INSERT OR IGNORE INTO wallets(user_id, balance) VALUES ('wanderer', 20)").run();
    db.prepare("INSERT OR IGNORE INTO attachments(id, name, mime_type, price, author_id, download_url) VALUES ('attachment-sample', '雾港设定集.txt', 'text/plain', 10, 'author', '/forum-downloads/mist-harbor.txt')").run();

    // 待审核校订建议：文本与正文逐字一致，并记录文章/章节/行定位，
    // 供阅读页按章过滤与行级字对比。五章各一条演示数据，每次启动重置为固定状态。
    db.prepare("DELETE FROM suggestions WHERE id IN ('suggestion-1', 'suggestion-2', 'suggestion-3', 'suggestion-4', 'suggestion-5')").run();
    const insertSuggestion = db.prepare("INSERT INTO suggestions(id, document_id, chapter_id, chapter_title, line_no, line_text, from_text, to_text, reason, status, author_id, reviewer_id, created_at, reviewed_at) VALUES (?, 'demo-post', ?, ?, ?, ?, ?, ?, ?, 'pending', ?, NULL, ?, NULL)");
    insertSuggestion.run(
      "suggestion-1",
      "chapter-0",
      "楔子 · 雨季之前",
      2,
      "雨季开始前的第七天，港口送走了最后一班客船。雾线从海面爬上来，把整条长街泡得发软。",
      "雾线从海面爬上来",
      "雾气从海面爬上来",
      "“雾线”非惯用说法，建议改为“雾气”",
      "reader",
      now,
    );
    insertSuggestion.run(
      "suggestion-2",
      "chapter-1",
      "第一章 · 潮汐表",
      2,
      "潮声沿着旧城墙漫上来，旅人把未寄出的信压在灯下。",
      "旅人把未寄出的信压在灯下",
      "旅人把未寄出的信压在油灯下",
      "与第三章“油灯”细节呼应，避免后文才出现的新物件",
      "wanderer",
      now,
    );
    insertSuggestion.run(
      "suggestion-3",
      "chapter-2",
      "第二章 · 陌生船票",
      3,
      "调查检定 ，线索足够。",
      "，线索足够",
      "，线索已足够",
      "检定通过后语气应更笃定",
      "reader",
      now,
    );
    insertSuggestion.run(
      "suggestion-4",
      "chapter-3",
      "第三章 · 没有寄件人的信",
      3,
      "第三扇窗的窗台积着薄灰，玻璃内侧贴着一封没有寄件人的信。这一句包含结局线索，请谨慎查看。",
      "玻璃内侧贴着一封没有寄件人的信",
      "玻璃内侧贴着一封没有寄件人的信笺",
      "与第一章“信笺”用词统一",
      "reader",
      now,
    );
    insertSuggestion.run(
      "suggestion-5",
      "chapter-4",
      "第四章 · 待发布",
      2,
      "这一章还躺在作者的抽屉里，只有一张潮汐表的复印件，和一句没来得及写下的开头。",
      "这一章还躺在作者的抽屉里",
      "这一章还躺在作者的抽屉底层",
      "“抽屉底层”更符合藏物的叙事逻辑",
      "wanderer",
      now,
    );

    db.prepare("INSERT OR IGNORE INTO polls(id, question, multiple, minimum_role) VALUES ('poll-route', '下一章先去哪里？', 0, 'reader')").run();
    db.prepare("INSERT OR IGNORE INTO poll_options(id, poll_id, label, sort_order) VALUES ('poll-option-tower', 'poll-route', '钟楼', 1)").run();
    db.prepare("INSERT OR IGNORE INTO poll_options(id, poll_id, label, sort_order) VALUES ('poll-option-dock', 'poll-route', '旧码头', 2)").run();
    db.prepare("INSERT OR IGNORE INTO poll_options(id, poll_id, label, sort_order) VALUES ('poll-option-library', 'poll-route', '潮汐图书馆', 3)").run();
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

/** 打开数据库、启用安全 pragma、执行迁移并可选写入幂等种子。 */
export function createDatabase(options: DatabaseOptions): DatabaseSync {
  if (options.path !== ":memory:") mkdirSync(dirname(options.path), { recursive: true });
  const db = new DatabaseSync(options.path);
  // WAL 允许读取与单写入并行；外键和 busy_timeout 防止静默脏数据及瞬时锁失败。
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
  runMigration(db, 1, migrationV1);
  runMigration(db, 2, migrationV2);
  runMigration(db, 3, migrationV3);
  runMigration(db, 4, migrationV4);
  // V5 重建 document_revisions（document_mutations 通过外键引用它），
  // 迁移期间临时关闭外键检查以允许 DROP + RENAME。
  db.exec("PRAGMA foreign_keys = OFF");
  runMigration(db, 5, migrationV5);
  db.exec("PRAGMA foreign_keys = ON");
  runMigration(db, 6, migrationV6);
  runMigration(db, 7, migrationV7);
  runMigration(db, 8, migrationV8);
  runMigration(db, 9, migrationV9);
  runMigration(db, 10, migrationV10);
  if (options.seed !== false) seed(db);
  return db;
}
