import type { Editor } from "@tiptap/react";
import {
  AtSign,
  Dice5,
  FileText,
  ImagePlus,
  Link2,
  SeparatorHorizontal,
  Smile,
  TextQuote,
  Trash2,
  UnlockKeyhole,
  Vote,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import {
  ALLOWED_DOCUMENT_FONT_SIZES,
  MAX_DOCUMENT_FONT_SIZE,
  MIN_DOCUMENT_FONT_SIZE,
} from "@ricetext/contracts";
import { isContainerNodeActive, isRichNodeActive } from "./commands";

/** 插入类工具的稳定标识，工具栏按钮、折叠菜单与右键菜单共享。 */
export type InsertTool =
  | "emoji"
  | "image"
  | "dice"
  | "attachment"
  | "mention"
  | "poll"
  | "excerpt"
  | "deleteExcerpt"
  | "gate"
  | "ungate"
  | "horizontalRule"
  | "link";

export interface InsertToolDefinition {
  tool: InsertTool;
  label: string;
  icon: LucideIcon;
  /**
   * 交互形态：`dialog` 走 ToolbarDialogs 的 requestInsert 通道；
   * `panel`（表情）是就地展开的拾取面板，需要编辑器实例直接渲染。
   */
  surface?: "dialog" | "panel";
  /** 激活判定：当前选中节点即该工具对应节点时高亮。 */
  isActive?: (editor: Editor) => boolean;
  /** 禁用判定：选区/光标状态不允许使用该工具时置灰。 */
  isDisabled?: (editor: Editor) => boolean;
}

/** 文字颜色面板与右键子菜单共用的固定色板。 */
export const TOOLBAR_COLORS = ["#20272c", "#197c73", "#b66a0a", "#b63434", "#6b4bb5"];

/** 字体下拉与右键子菜单共用的字体选项（空值 = 默认字体）。 */
export const FONT_FAMILIES = [
  { value: "", label: "默认字体" },
  { value: "sans-serif", label: "黑体" },
  { value: "Noto Serif SC Variable", label: "宋体" },
  { value: "monospace", label: "等宽" },
] as const;

/**
 * 字号下拉与右键子菜单共用的预设。
 *
 * 由契约的持久化白名单派生，保证 UI 只提供能存下来的值；上界 512px 是为了
 * 「整屏大小的表情」——表情按 em 渲染，把字号调大就能把它一起放大。
 */
export const FONT_SIZES = ALLOWED_DOCUMENT_FONT_SIZES.map((size) => `${size}px`);

/** 字号白名单区间；自定义输入按它收窄。 */
export const FONT_SIZE_RANGE = {
  min: MIN_DOCUMENT_FONT_SIZE,
  max: MAX_DOCUMENT_FONT_SIZE,
} as const;

/** 插入内容子菜单/折叠「插入内容」组共用的内容工具。 */
export const INSERT_CONTENT_TOOLS: readonly InsertToolDefinition[] = [
  {
    tool: "emoji",
    label: "表情",
    icon: Smile,
    surface: "panel",
  },
  {
    tool: "image",
    label: "图片",
    icon: ImagePlus,
    isActive: (editor) => isRichNodeActive(editor, "richImage"),
  },
  {
    tool: "dice",
    label: "骰子",
    icon: Dice5,
    isActive: (editor) => isRichNodeActive(editor, "diceRoll"),
  },
  {
    tool: "attachment",
    label: "附件",
    icon: FileText,
    isActive: (editor) => isRichNodeActive(editor, "attachmentRef"),
  },
  {
    tool: "mention",
    label: "提及用户",
    icon: AtSign,
    isActive: (editor) => isRichNodeActive(editor, "mention"),
  },
  {
    tool: "poll",
    label: "投票",
    icon: Vote,
    isActive: (editor) => isRichNodeActive(editor, "pollRef"),
  },
  {
    tool: "excerpt",
    label: "小说摘录",
    icon: TextQuote,
    isActive: (editor) => isContainerNodeActive(editor, "novelExcerpt"),
  },
  {
    tool: "horizontalRule",
    label: "分割线",
    icon: SeparatorHorizontal,
    isDisabled: (editor) => !editor.can().setHorizontalRule(),
  },
];

/** 仅工具栏/「更多工具」菜单展示的回复可见工具。 */
export const MORE_INSERT_TOOLS: readonly InsertToolDefinition[] = [
  {
    tool: "gate",
    label: "回复后可见",
    icon: UnlockKeyhole,
    isActive: (editor) => isContainerNodeActive(editor, "replyGate"),
  },
  {
    tool: "ungate",
    label: "取消回复可见",
    icon: XCircle,
    isDisabled: (editor) => !isContainerNodeActive(editor, "replyGate"),
  },
  {
    tool: "deleteExcerpt",
    label: "删除摘录",
    icon: Trash2,
    isDisabled: (editor) => !isContainerNodeActive(editor, "novelExcerpt"),
  },
];

/**
 * 链接：不走「插入内容」菜单的自动枚举（桌面工具栏与折叠菜单有专用入口），
 * 仅提供定义并纳入 INSERT_TOOL_DEFINITIONS 索引。
 */
export const LINK_TOOL: InsertToolDefinition = {
  tool: "link",
  label: "链接",
  icon: Link2,
  isActive: (editor) => editor.isActive("link"),
};

/** 全部插入工具按 ID 索引，供业务节点分组直接取用。 */
export const INSERT_TOOL_DEFINITIONS: Readonly<Record<InsertTool, InsertToolDefinition>> =
  Object.fromEntries(
    [...INSERT_CONTENT_TOOLS, ...MORE_INSERT_TOOLS, LINK_TOOL].map((definition) => [
      definition.tool,
      definition,
    ]),
  ) as Readonly<Record<InsertTool, InsertToolDefinition>>;
