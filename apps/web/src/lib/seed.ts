import type {
  CommentReply,
  DocumentEnvelope,
  ForumSuggestion,
  RevisionSummary,
  SeedIdentity,
} from "./types";

/** 断网 fallback 与 UI 状态展示使用的身份；不代表生产账户系统。 */
export const identities: SeedIdentity[] = [
  {
    id: "user_author",
    name: "林稻",
    role: "author",
    avatar: "林",
    coins: 860,
    replied: true,
  },
  {
    id: "user_reader",
    name: "晚风翻页",
    role: "reader",
    avatar: "晚",
    coins: 120,
    replied: false,
  },
  {
    id: "user_moderator",
    name: "版务小禾",
    role: "moderator",
    avatar: "禾",
    coins: 520,
    replied: true,
  },
];

/** API 尚未返回时的首屏占位正文，也是断网模式的默认文档。 */
export const defaultDocument: DocumentEnvelope = {
  id: "demo-post",
  title: "雾港来信：第三章讨论与校订",
  schemaVersion: 1,
  revision: 18,
  savedAt: new Date().toISOString(),
  content: {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 1 },
        content: [{ type: "text", text: "雾港来信：第三章讨论与校订" }],
      },
      {
        type: "paragraph",
        content: [
          { type: "text", text: "潮声越过旧防波堤时，灯塔正好熄灭。" },
          {
            type: "inlineCommentAnchor",
            attrs: { threadId: "thread_1", count: 6, placement: "end" },
          },
        ],
      },
      {
        type: "novelExcerpt",
        attrs: {
          bookTitle: "雾港来信",
          chapterTitle: "第三章 · 没有寄件人的信",
          author: "林稻",
          sourceUrl: null,
          variant: "desktop-book",
        },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "她在信封夹层里摸到一粒细砂，湿冷，像刚从退潮后的礁石上取下。",
              },
            ],
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
        type: "paragraph",
        content: [
          {
            type: "text",
            text: "这一句包含结局线索，请谨慎查看。",
            marks: [{ type: "spoiler" }],
          },
        ],
      },
      {
        type: "replyGate",
        attrs: { gateId: "gate_forum", prompt: "回复主题后显示本段航海日志。" },
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "日志坐标：北纬 31°14′，雾号每七分钟响一次。",
              },
            ],
          },
        ],
      },
    ],
  },
};

/** 断网时仍可操作的版本历史 fixture。 */
export const seedRevisions: RevisionSummary[] = [
  {
    revision: 18,
    savedAt: new Date().toISOString(),
    authorName: "林稻",
    summary: "补充第三章摘录与骰点",
  },
  {
    revision: 17,
    savedAt: new Date(Date.now() - 36e5).toISOString(),
    authorName: "林稻",
    summary: "接受读者错字建议",
  },
  {
    revision: 16,
    savedAt: new Date(Date.now() - 864e5).toISOString(),
    authorName: "版务小禾",
    summary: "调整回复可见范围",
  },
];

/** 断网时用于展示树状间贴和作者回复的 fixture。 */
export const seedComments: CommentReply[] = [
  {
    id: "comment_1",
    parentId: null,
    author: identities[1]!,
    body: "“灯塔正好熄灭”这句很有画面感。这里是停电，还是有人刻意关闭？",
    createdAt: new Date(Date.now() - 9e5).toISOString(),
    upvotes: 14,
    downvotes: 1,
    myVote: 0,
    children: [
      {
        id: "comment_2",
        parentId: "comment_1",
        author: identities[0]!,
        body: "后文会给出能回看的物证，目前可以先按两种可能理解。",
        createdAt: new Date(Date.now() - 6e5).toISOString(),
        upvotes: 9,
        downvotes: 0,
        myVote: 1,
        children: [],
      },
    ],
  },
  {
    id: "comment_3",
    parentId: null,
    author: identities[2]!,
    body: "已把本段与上一章的时间线核对过，时间间隔一致。",
    createdAt: new Date(Date.now() - 3e5).toISOString(),
    upvotes: 6,
    downvotes: 0,
    myVote: 0,
    children: [],
  },
];

/**
 * 断网时仍可展示的校订建议：文本与 defaultDocument 的行逐字一致，
 * 行号指向该文档章节（chapter-0）内的行。
 */
export const seedSuggestions: ForumSuggestion[] = [
  {
    id: "suggestion_1",
    documentId: "demo-post",
    chapterId: "chapter-0",
    chapterTitle: "正文",
    lineNo: 2,
    lineText: "潮声越过旧防波堤时，灯塔正好熄灭。",
    fromText: "潮声越过旧防波堤时，灯塔正好熄灭",
    toText: "潮声越过旧防波堤时，灯塔恰好熄灭",
    reason: "“正好”过于口语，建议改为“恰好”",
    status: "pending",
    authorId: "reader",
    reviewerId: null,
    createdAt: new Date(Date.now() - 9e5).toISOString(),
  },
  {
    id: "suggestion_2",
    documentId: "demo-post",
    chapterId: "chapter-0",
    chapterTitle: "正文",
    lineNo: 4,
    lineText: "调查检定 ，线索足够。",
    fromText: "，线索足够",
    toText: "，线索已足够",
    reason: "检定通过后语气应更笃定",
    status: "pending",
    authorId: "reader",
    reviewerId: null,
    createdAt: new Date(Date.now() - 8e5).toISOString(),
  },
  {
    id: "suggestion_3",
    documentId: "demo-post",
    chapterId: "chapter-0",
    chapterTitle: "正文",
    lineNo: 5,
    lineText: "这一句包含结局线索，请谨慎查看。",
    fromText: "这一句包含结局线索，请谨慎查看",
    toText: "这一句包含结局线索，请谨慎阅读",
    reason: "“查看”与阅读场景不符，建议改为“阅读”",
    status: "pending",
    authorId: "wanderer",
    reviewerId: null,
    createdAt: new Date(Date.now() - 5e5).toISOString(),
  },
  {
    id: "suggestion_4",
    documentId: "demo-post",
    chapterId: "chapter-0",
    chapterTitle: "正文",
    lineNo: 6,
    lineText: "日志坐标：北纬 31°14′，雾号每七分钟响一次。",
    fromText: "雾号每七分钟响一次",
    toText: "雾号每七分钟鸣响一次",
    reason: "“鸣响”拟声更贴切",
    status: "pending",
    authorId: "wanderer",
    reviewerId: null,
    createdAt: new Date(Date.now() - 4e5).toISOString(),
  },
];
