import type { Editor } from "@tiptap/react";
import {
  AtSign,
  Dice5,
  FileText,
  ImagePlus,
  Link2,
  MessageCirclePlus,
  TextQuote,
  UnlockKeyhole,
  Vote,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { isContainerNodeActive, isRichNodeActive } from "./commands";

/** 插入类工具的稳定标识，工具栏按钮、折叠菜单与右键菜单共享。 */
export type InsertTool =
  | "image"
  | "dice"
  | "attachment"
  | "mention"
  | "poll"
  | "excerpt"
  | "comment"
  | "gate"
  | "ungate"
  | "link";

export interface InsertToolDefinition {
  tool: InsertTool;
  label: string;
  icon: LucideIcon;
  /** 激活判定：当前选中节点即该工具对应节点时高亮。 */
  isActive?: (editor: Editor) => boolean;
  /** 禁用判定：选区/光标状态不允许使用该工具时置灰。 */
  isDisabled?: (editor: Editor) => boolean;
}

/** 文字颜色面板与右键子菜单共用的固定色板。 */
export const TOOLBAR_COLORS = [
  "#20272c",
  "#197c73",
  "#b66a0a",
  "#b63434",
  "#6b4bb5",
];

/** 字体下拉与右键子菜单共用的字体选项（空值 = 默认字体）。 */
export const FONT_FAMILIES = [
  { value: "", label: "默认字体" },
  { value: "sans-serif", label: "黑体" },
  { value: "Noto Serif SC Variable", label: "宋体" },
  { value: "monospace", label: "等宽" },
] as const;

/** 字号下拉与右键子菜单共用的字号选项。 */
export const FONT_SIZES = [
  "12px",
  "14px",
  "16px",
  "18px",
  "20px",
  "24px",
  "28px",
  "32px",
] as const;

/** 插入内容子菜单/折叠「插入内容」组共用的内容工具。 */
export const INSERT_CONTENT_TOOLS: readonly InsertToolDefinition[] = [
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
];

/** 仅工具栏/「更多工具」菜单展示的回复可见与间贴锚点工具。 */
export const MORE_INSERT_TOOLS: readonly InsertToolDefinition[] = [
  {
    tool: "comment",
    label: "间贴锚点",
    icon: MessageCirclePlus,
    isActive: (editor) => isRichNodeActive(editor, "inlineCommentAnchor"),
    isDisabled: (editor) => isContainerNodeActive(editor, "replyGate"),
  },
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
export const INSERT_TOOL_DEFINITIONS: Readonly<
  Record<InsertTool, InsertToolDefinition>
> = Object.fromEntries(
  [...INSERT_CONTENT_TOOLS, ...MORE_INSERT_TOOLS, LINK_TOOL].map((definition) => [
    definition.tool,
    definition,
  ]),
) as Readonly<Record<InsertTool, InsertToolDefinition>>;
