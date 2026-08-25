import type {
  Attachment,
  Chapter,
  Poll,
  Suggestion,
} from "@ricetext/contracts";
import type {
  DiceRollAttributes,
  EditorMode as CoreEditorMode,
  JSONContent,
  UploadedAsset as CoreUploadedAsset,
} from "@ricetext/editor-core";

/** 与 editor-core 共用的 Tiptap/ProseMirror JSON 类型。 */
export type RichTextNode = JSONContent;

/** 编辑器的三种布局预设。 */
export type EditorMode = CoreEditorMode;

/**
 * 文档读取与更新使用的统一信封。
 * 字段与 @ricetext/contracts 的 DocumentEnvelope 对齐，仅两处差异：
 * content 使用编辑器宽松的 JSONContent（编辑器/查看器直接消费），
 * storage 标记本地缓存落点。
 */
export interface DocumentEnvelope {
  /** 稳定文档 ID。 */
  id: string;
  /** 帖子或章节标题。 */
  title: string;
  /** Tiptap JSON schema 版本。 */
  schemaVersion: number;
  /** 单调递增的乐观并发版本号。 */
  revision: number;
  /** 最近一次成功保存时间。 */
  savedAt: string;
  /** 唯一权威正文格式。 */
  content: RichTextNode;
  /** 当前副本的落点；local-cache 表示 API 不可达时的本机缓存副本。 */
  storage?: "server" | "local-cache";
}

/** 单条不可变历史版本摘要（展示字段；完整契约见 @ricetext/contracts）。 */
export interface RevisionSummary {
  /** 历史 revision 编号。 */
  revision: number;
  /** 版本创建时间。 */
  savedAt: string;
  /** 操作者显示名。 */
  authorName: string;
  /** 保存、回滚或建议合并摘要。 */
  summary: string;
  /** 本次修订应用的 steps 的人类可读描述（快照修订为 null）。 */
  stepsSummary: string | null;
}

/** 编辑器保存状态，供宿主页面显示而不依赖实现细节。 */
export type SaveState =
  "loading" | "saved" | "dirty" | "saving" | "conflict" | "offline" | "error";

/** 用于本地权限、金币和回复状态的身份。 */
export interface SeedIdentity {
  /** 前端稳定 ID；请求时映射为 API 的论坛身份。 */
  id: string;
  /** 显示名。 */
  name: string;
  /** 决定编辑、投票和审核能力的角色。 */
  role: "author" | "reader" | "moderator";
  /** 无图片时显示的头像文字。 */
  avatar: string;
  /** 附件购买余额。 */
  coins: number;
  /** 是否已经回复主题，用于回复可见投影。 */
  replied: boolean;
}

/** Web 间贴树使用的递归显示模型（结构是共享契约的子集）。 */
export interface CommentReply {
  /** 回复 ID。 */
  id: string;
  /** 父回复 ID；null 表示根回复。 */
  parentId: string | null;
  /** 回复作者。 */
  author: SeedIdentity;
  /** 纯文本回复内容。 */
  body: string;
  /** 创建时间。 */
  createdAt: string;
  /** 点赞数。 */
  upvotes: number;
  /** 点踩数。 */
  downvotes: number;
  /** 当前身份投票；0 表示未投票。 */
  myVote: -1 | 0 | 1;
  /** 楼中楼子回复。 */
  children: CommentReply[];
}

/** 与 editor-core 共用的稳定骰子 attrs。 */
export type DiceResult = DiceRollAttributes;

/** 与 editor-core 共用的上传图片元数据。 */
export type UploadedAsset = CoreUploadedAsset;

/** 纠错建议（复用共享契约类型）。 */
export type ForumSuggestion = Suggestion;

/** 付费附件（复用共享契约类型）。 */
export type ForumAttachment = Attachment;

/** 投票详情（复用共享契约类型）。 */
export type ForumPoll = Poll;

/** 章节目录项（复用共享契约类型）。 */
export type ForumChapterItem = Chapter;
