/** 稳定的上传领域代码。本地化标签由对话框负责。 */
export type ChapterUploadAction =
  | "add"
  | "modify"
  | "unchanged"
  | "remote_only";
export type ChapterUploadStatus =
  | "pending"
  | "uploading"
  | "uploaded"
  | "unchanged"
  | "awaiting_replacement"
  | "failed";

export interface ChapterUploadRow {
  id: string;
  title: string;
  volumeTitle?: string;
  action: ChapterUploadAction;
  status: ChapterUploadStatus;
  attempts: number;
  error?: string;
  retryable?: boolean;
}

export interface PlannedUploadChapter extends ChapterUploadRow {
  order: number;
  hash: string;
  baseRevision: number;
}

/** 运行时计划；持久化版本由检查点编解码器管理。 */
export interface ChapterUploadPlan {
  novelId: string;
  gaps: number;
  chapters: PlannedUploadChapter[];
}

/** prepare 阶段生成并在每批上传后更新的差异与进度摘要。 */
export interface ChapterUploadDiff {
  /** 服务器完成原子发布前为 false。为兼容旧版调用方，此字段可选。 */
  published?: boolean;
  total: number;
  toUpdate: number;
  added: number;
  modified: number;
  /** 服务器存在、当前本地长文本中不存在，将在原子发布时替换的章节数。 */
  remoteOnly: number;
  uploaded: number;
  /** 失败（含不可重试冲突）章节数。 */
  failed: number;
  /** 待上传（含上传中）章节数。 */
  pending: number;
  gaps: number;
  /** 当前正在发送的第几批（从 1 开始），未在上传时为 null。 */
  batchCurrent: number | null;
  /** 当前运行的预计批次数，未在上传时为 null。 */
  batchTotal: number | null;
  rows: ChapterUploadRow[];
}

/** 覆盖检查使用的章节信息。 */
export interface CoverageChapter {
  id: string;
  title: string;
  charCount: number;
  /** 在导入原文中的起始偏移；手动添加的章节为 null。 */
  start: number | null;
  /** 在导入原文中的结束偏移（不含）；手动添加的章节为 null。 */
  end: number | null;
  /** 章节正文开头片段，用于与原文对比。 */
  preview: string;
}
