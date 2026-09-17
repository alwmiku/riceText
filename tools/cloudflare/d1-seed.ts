// 本地 D1 的演示种子：与 Node API 时代 SQLite 的 seed() 保持同一份演示数据
// （文章、五章目录、间贴、校订建议、投票、附件与钱包），差别只在写入目标。
//
// 这里只生成 SQL 文本、不直接连库：E2E 准备把它写成 .sql 文件交给 wrangler 的
// `d1 execute --file`，批处理里出现错误时整批回滚，不会留下半份演示数据。
// 表结构不在这里定义——唯一的 schema 来源是 apps/worker/migrations。
import type { JSONContent } from "@ricetext/document-core";
import { PASSWORD_HASH_ITERATIONS } from "@ricetext/contracts";

/** 演示文章 ID；E2E 用 localStorage 预选它。 */
export const DEMO_DOCUMENT_ID = "demo-post";

/** 密码登录 E2E 使用的固定账号；只写入一次性的本地 D1。 */
export interface DemoPasswordCredential {
  userId: string;
  username: string;
  /** base64url 编码的 PBKDF2 盐。 */
  salt: string;
  /** base64url 编码的派生密钥。 */
  passwordHash: string;
}

/** 种子写入选项。 */
export interface DemoSeedOptions {
  /** 固定时间戳；测试断言与 review 排序都依赖可复现的时间。 */
  now: string;
  /** 登录凭据；不传时跳过 password_credentials。 */
  password?: DemoPasswordCredential;
  /**
   * 是否写入文章域（文档、章节、评论、投票、附件、建议等）。
   *
   * 密码登录 E2E 要求数据库里「一篇文章都没有」：此时只写账号与凭据。
   * 只清空文章域是不够的——种子里的文章插入语句会紧跟删除之后把它们再建回来。
   */
  includeDocuments?: boolean;
}

/** 转义为 SQL 字面量；种子里的中文与 JSON 都经过这一层，避免手写引号出错。 */
function quote(value: string | number): string {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("种子不能写入非有限数字：" + String(value));
    return String(value);
  }
  return "'" + value.replaceAll("'", "''") + "'";
}

/** 生成一条 INSERT 语句。 */
function insert(table: string, row: Record<string, string | number | null>, mode = ""): string {
  const columns = Object.keys(row);
  return (
    "INSERT" +
    (mode ? " " + mode : "") +
    " INTO " +
    table +
    "(" +
    columns.join(", ") +
    ") VALUES (" +
    columns.map((column) => (row[column] === null ? "NULL" : quote(row[column]!))).join(", ") +
    ");"
  );
}

/**
 * 演示正文：五章目录与正文一一对应。
 *
 * 章节由 H1（`chapterStart`）划分，章节目录行按章序号对应；正文里的
 * `inlineCommentAnchor`、`diceRoll`、`novelExcerpt`、`spoiler`、`replyGate`、
 * `attachmentRef`、`pollRef` 是 E2E 阅读页与创作页的验收素材，改动前先看 e2e/app.spec.ts。
 */
export const DEMO_DOCUMENT_CONTENT: JSONContent = {
  type: "doc",
  content: [
    { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "雾港来信" }] },
    {
      type: "heading",
      attrs: { level: 1, chapterStart: true },
      content: [{ type: "text", text: "楔子 雨季之前" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "雨季开始前的第七天，港口送走了最后一班客船。雾线从海面爬上来，把整条长街泡得发软。",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "邮差在码头边捡到一封没有署名、也没有邮票的信。信封被雨水浸透，只留下一个模糊的地址：灯塔脚下，第三扇窗。",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 1, chapterStart: true },
      content: [{ type: "text", text: "第一章 潮汐表" }],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "潮声沿着旧城墙漫上来，旅人把未寄出的信压在灯下。" },
        {
          type: "inlineCommentAnchor",
          attrs: { threadId: "anchor-opening", count: 2, placement: "end" },
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "灯塔管理员翻着泛黄的潮汐表说，今夜没有雾，却有风。船不该出港的，可船还是出了。",
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 1, chapterStart: true },
      content: [{ type: "text", text: "第二章 陌生船票" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "他在抽屉底层找到一张陌生的船票。日期是明天，航线却早已停运多年。票根背面用铅笔写着：如果你看到这封信，请把它送回钟楼。",
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "调查检定 " },
        {
          type: "diceRoll",
          attrs: {
            rollId: "roll_seed",
            expression: "3d5",
            rolls: [4, 3, 5],
            total: 12,
            rerollOf: null,
          },
        },
        { type: "text", text: "，线索足够。" },
      ],
    },
    {
      type: "heading",
      attrs: { level: 1, chapterStart: true },
      content: [{ type: "text", text: "第三章 没有寄件人的信" }],
    },
    {
      type: "novelExcerpt",
      attrs: {
        variant: "fanqie",
        bookTitle: "雾港来信",
        chapterTitle: "第三章 没有寄件人的信",
        author: "林见",
        sourceUrl: "https://example.com/books/mist-harbor",
      },
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "如果明天仍有雾，就沿着钟声的方向走。" }],
        },
      ],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "第三扇窗的窗台积着薄灰，玻璃内侧贴着一封没有寄件人的信。这一句包含结局线索，请谨慎查看。",
          marks: [{ type: "spoiler" }],
        },
      ],
    },
    {
      type: "heading",
      attrs: { level: 1, chapterStart: true },
      content: [{ type: "text", text: "第四章 待发布" }],
    },
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "这一章还躺在作者的抽屉里，只有一张潮汐表的复印件，和一句没来得及写下的开头。",
        },
      ],
    },
    {
      type: "replyGate",
      attrs: { gateId: "gate-bonus", prompt: "回复后查看番外片段" },
      content: [
        { type: "paragraph", content: [{ type: "text", text: "番外内容由服务端权限投影。" }] },
      ],
    },
    {
      type: "attachmentRef",
      attrs: {
        attachmentId: "attachment-sample",
        name: "雾港设定集.txt",
        mimeType: "text/plain",
        size: 2048,
        priceCoins: 10,
      },
    },
    {
      type: "pollRef",
      attrs: {
        pollId: "poll-route",
        question: "下一章先去哪里？",
        multiple: false,
        options: [
          { id: "poll-option-tower", label: "钟楼" },
          { id: "poll-option-dock", label: "旧码头" },
          { id: "poll-option-library", label: "潮汐图书馆" },
        ],
      },
    },
  ],
};

/** 章节目录：ID、标题与正文 H1 的顺序一一对应，`chapter-3` 是 E2E 的默认章。 */
const DEMO_CHAPTERS: ReadonlyArray<{ id: string; title: string }> = [
  { id: "chapter-0", title: "楔子 · 雨季之前" },
  { id: "chapter-1", title: "第一章 · 潮汐表" },
  { id: "chapter-2", title: "第二章 · 陌生船票" },
  { id: "chapter-3", title: "第三章 · 没有寄件人的信" },
  { id: "chapter-4", title: "第四章 · 待发布" },
];

/** 待审核校订建议：`lineText` 与正文逐字一致，否则行级字对比会定位失败。 */
const DEMO_SUGGESTIONS: ReadonlyArray<{
  id: string;
  chapterId: string;
  chapterTitle: string;
  lineNo: number;
  lineText: string;
  fromText: string;
  toText: string;
  reason: string;
  authorId: string;
}> = [
  {
    id: "suggestion-1",
    chapterId: "chapter-0",
    chapterTitle: "楔子 · 雨季之前",
    lineNo: 2,
    lineText: "雨季开始前的第七天，港口送走了最后一班客船。雾线从海面爬上来，把整条长街泡得发软。",
    fromText: "雾线从海面爬上来",
    toText: "雾气从海面爬上来",
    reason: "“雾线”非惯用说法，建议改为“雾气”",
    authorId: "reader",
  },
  {
    id: "suggestion-2",
    chapterId: "chapter-1",
    chapterTitle: "第一章 · 潮汐表",
    lineNo: 2,
    lineText: "潮声沿着旧城墙漫上来，旅人把未寄出的信压在灯下。",
    fromText: "旅人把未寄出的信压在灯下",
    toText: "旅人把未寄出的信压在油灯下",
    reason: "与第三章“油灯”细节呼应，避免后文才出现的新物件",
    authorId: "wanderer",
  },
  {
    id: "suggestion-3",
    chapterId: "chapter-2",
    chapterTitle: "第二章 · 陌生船票",
    lineNo: 3,
    lineText: "调查检定 ，线索足够。",
    fromText: "，线索足够",
    toText: "，线索已足够",
    reason: "检定通过后语气应更笃定",
    authorId: "reader",
  },
  {
    id: "suggestion-4",
    chapterId: "chapter-3",
    chapterTitle: "第三章 · 没有寄件人的信",
    lineNo: 3,
    lineText:
      "第三扇窗的窗台积着薄灰，玻璃内侧贴着一封没有寄件人的信。这一句包含结局线索，请谨慎查看。",
    fromText: "玻璃内侧贴着一封没有寄件人的信",
    toText: "玻璃内侧贴着一封没有寄件人的信笺",
    reason: "与第一章“信笺”用词统一",
    authorId: "reader",
  },
  {
    id: "suggestion-5",
    chapterId: "chapter-4",
    chapterTitle: "第四章 · 待发布",
    lineNo: 2,
    lineText: "这一章还躺在作者的抽屉里，只有一张潮汐表的复印件，和一句没来得及写下的开头。",
    fromText: "这一章还躺在作者的抽屉里",
    toText: "这一章还躺在作者的抽屉底层",
    reason: "“抽屉底层”更符合藏物的叙事逻辑",
    authorId: "wanderer",
  },
];

/** 生成演示种子语句；全部幂等（INSERT OR IGNORE / 先删后插固定 ID）。 */
export function demoSeedStatements(options: DemoSeedOptions): string[] {
  const { now, password, includeDocuments = true } = options;
  const statements: string[] = [];

  for (const user of [
    {
      id: "author",
      name: "林见",
      role: "author",
      isFriend: 1,
      bio: "《雾港来信》作者，负责章节与修订审核。",
    },
    {
      id: "reader",
      name: "小满",
      role: "reader",
      isFriend: 1,
      bio: "喜欢在段落末留下间贴的读者。",
    },
    {
      id: "moderator",
      name: "版务七号",
      role: "moderator",
      isFriend: 0,
      bio: "负责内容审核与版本恢复。",
    },
    {
      id: "wanderer",
      name: "远舟",
      role: "reader",
      isFriend: 0,
      bio: "可由服务端解析的非好友用户。",
    },
  ]) {
    statements.push(
      insert(
        "users",
        {
          id: user.id,
          name: user.name,
          role: user.role,
          is_friend: user.isFriend,
          bio: user.bio,
          created_at: now,
          updated_at: now,
        },
        "OR IGNORE",
      ),
    );
  }
  // 生产登录依赖 auth_identities / password_credentials；演示身份不算登录凭据，
  // 但部署校验（tools/cloudflare/verify-target.mjs）要求有权限的用户都能登录。
  if (password) {
    statements.push(
      insert(
        "password_credentials",
        {
          user_id: password.userId,
          username: password.username,
          salt: password.salt,
          password_hash: password.passwordHash,
          iterations: PASSWORD_HASH_ITERATIONS,
          failed_attempts: 0,
          locked_until: null,
          updated_at: now,
        },
        "OR REPLACE",
      ),
    );
  }

  // 只写账号与凭据的模式（密码登录 E2E）到此为止，文章域整体略过。
  if (!includeDocuments) return statements;

  statements.push(
    insert(
      "documents",
      {
        id: DEMO_DOCUMENT_ID,
        title: "雾港来信 · 第一章",
        schema_version: 1,
        current_revision: 1,
        created_by: "author",
        created_at: now,
        updated_at: now,
      },
      "OR IGNORE",
    ),
    insert(
      "document_acl",
      { document_id: DEMO_DOCUMENT_ID, user_id: "author", permission: "admin", created_at: now },
      "OR IGNORE",
    ),
    insert(
      "document_revisions",
      {
        document_id: DEMO_DOCUMENT_ID,
        revision: 1,
        schema_version: 1,
        content_json: JSON.stringify(DEMO_DOCUMENT_CONTENT),
        steps_json: null,
        author_id: "author",
        operation: "seed",
        target_revision: null,
        created_at: now,
      },
      "OR IGNORE",
    ),
  );

  // 章节行的 revision 与 updated_at 必须保留（重启或重播种子不能清空独立版本），
  // 因此用 ON CONFLICT 只同步标题与排序。content_json 留空：正文走文档快照，
  // 章节正文一旦为空，客户端会回退到文档正文而不是报 404。
  statements.push(
    "INSERT OR IGNORE INTO chapters(id, title, sort_order, document_id, revision, volume_title, content_json, content_hash, updated_at, hidden) VALUES " +
      DEMO_CHAPTERS.map(
        (chapter, order) =>
          "(" +
          [chapter.id, chapter.title, order, DEMO_DOCUMENT_ID, 1, "", null, null, now, 0]
            .map((value) => (value === null ? "NULL" : quote(value)))
            .join(", ") +
          ")",
      ).join(", ") +
      " ON CONFLICT(document_id, id) DO UPDATE SET title=excluded.title, sort_order=excluded.sort_order;",
  );

  statements.push(
    insert(
      "comment_threads",
      { document_id: DEMO_DOCUMENT_ID, anchor_id: "anchor-opening", archived: 0, created_at: now },
      "OR IGNORE",
    ),
    insert(
      "comment_replies",
      {
        id: "comment-root",
        document_id: DEMO_DOCUMENT_ID,
        anchor_id: "anchor-opening",
        parent_id: null,
        author_id: "reader",
        body: "这里的钟声会不会和序章呼应？",
        created_at: now,
      },
      "OR IGNORE",
    ),
    insert(
      "comment_replies",
      {
        id: "comment-child",
        document_id: DEMO_DOCUMENT_ID,
        anchor_id: "anchor-opening",
        parent_id: "comment-root",
        author_id: "author",
        body: "会在第三章解释钟楼的来历。",
        created_at: now,
      },
      "OR IGNORE",
    ),
    insert(
      "comment_votes",
      { reply_id: "comment-root", user_id: "author", value: 1, created_at: now },
      "OR IGNORE",
    ),
    insert(
      "reply_gates",
      {
        id: "gate-bonus",
        document_id: DEMO_DOCUMENT_ID,
        content_json: JSON.stringify({
          type: "doc",
          content: [
            {
              type: "paragraph",
              content: [{ type: "text", text: "番外：邮差其实在第一封信到来前就见过旅人。" }],
            },
          ],
        }),
      },
      "OR IGNORE",
    ),
  );

  for (const wallet of [
    { userId: "author", balance: 100 },
    { userId: "reader", balance: 50 },
    { userId: "moderator", balance: 100 },
    { userId: "wanderer", balance: 20 },
  ]) {
    statements.push(
      insert("wallets", { user_id: wallet.userId, balance: wallet.balance }, "OR IGNORE"),
    );
  }
  statements.push(
    insert(
      "attachments",
      {
        id: "attachment-sample",
        name: "雾港设定集.txt",
        mime_type: "text/plain",
        price: 10,
        author_id: "author",
        asset_id: null,
        legacy_download_url: "https://example.com/mist-harbor.txt",
      },
      "OR IGNORE",
    ),
  );

  statements.push(
    insert(
      "polls",
      { id: "poll-route", question: "下一章先去哪里？", multiple: 0, minimum_role: "reader" },
      "OR IGNORE",
    ),
  );
  for (const [index, option] of [
    { id: "poll-option-tower", label: "钟楼" },
    { id: "poll-option-dock", label: "旧码头" },
    { id: "poll-option-library", label: "潮汐图书馆" },
  ].entries()) {
    statements.push(
      "INSERT OR IGNORE INTO poll_options(id, poll_id, label, sort_order) VALUES (" +
        [option.id, "poll-route", option.label, index + 1].map((value) => quote(value)).join(", ") +
        ");",
    );
  }
  // 校订建议每次重置为固定状态：上一次运行的审核结果不能污染本轮断言。
  // 必须同时限定 document_id：别的文章里存在同名 ID 时，删掉的就是用户的真实数据。
  statements.push(
    "DELETE FROM suggestions WHERE document_id = " +
      quote(DEMO_DOCUMENT_ID) +
      " AND id IN (" +
      DEMO_SUGGESTIONS.map((suggestion) => quote(suggestion.id)).join(", ") +
      ");",
  );
  for (const suggestion of DEMO_SUGGESTIONS) {
    statements.push(
      insert("suggestions", {
        id: suggestion.id,
        document_id: DEMO_DOCUMENT_ID,
        chapter_id: suggestion.chapterId,
        chapter_title: suggestion.chapterTitle,
        line_no: suggestion.lineNo,
        line_text: suggestion.lineText,
        from_text: suggestion.fromText,
        to_text: suggestion.toText,
        reason: suggestion.reason,
        status: "pending",
        author_id: suggestion.authorId,
        reviewer_id: null,
        created_at: now,
        reviewed_at: null,
      }),
    );
  }
  return statements;
}

/** 清空文章域（密码登录 E2E 从「空数据库」开始），账号与认证数据保留。 */
export const EMPTY_DOCUMENTS_SQL = [
  "PRAGMA defer_foreign_keys = TRUE;",
  "DELETE FROM chapter_upload_items;",
  "DELETE FROM chapter_uploads;",
  "DELETE FROM suggestion_review_guards;",
  "DELETE FROM suggestion_batches;",
  "DELETE FROM suggestions;",
  "DELETE FROM comment_votes;",
  "DELETE FROM comment_replies;",
  "DELETE FROM comment_threads;",
  "DELETE FROM reply_receipts;",
  "DELETE FROM reply_gates;",
  "DELETE FROM chapters;",
  "DELETE FROM chapter_write_guards;",
  "DELETE FROM chapter_revisions;",
  "DELETE FROM document_mutations;",
  "DELETE FROM document_revisions;",
  "DELETE FROM document_acl;",
  "DELETE FROM documents;",
];

const NEWLINE = String.fromCharCode(10);

/** 把语句拼成一份可交给 `wrangler d1 execute --file` 的 SQL 文件内容。 */
export function seedSql(statements: readonly string[]): string {
  return [
    "-- 由 tools/cloudflare/prepare-e2e.ts 生成：本地 D1 的演示种子，不要提交。",
    ...statements,
    "",
  ].join(NEWLINE);
}
