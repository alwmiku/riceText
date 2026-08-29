import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AtSign,
  Bold,
  Eraser,
  EyeOff,
  Heading1,
  Heading2,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageCirclePlus,
  MoreHorizontal,
  Quote,
  Redo2,
  Underline as UnderlineIcon,
  Undo2,
  UnlockKeyhole,
  XCircle,
} from "lucide-react";
import { DropdownMenuItem } from "../../components/ui";
import { ColorPicker } from "../../components/ui/color-picker";
import { cmd } from "./commands";
import {
  clearFormatting,
  redo,
  setColor,
  setFontFamily,
  setFontSize,
  setTextAlign,
  toggleBlockquote,
  toggleBold,
  toggleBulletList,
  toggleHeading,
  toggleItalic,
  toggleOrderedList,
  toggleSpoiler,
  toggleUnderline,
  undo,
} from "./editor-actions";
import {
  INSERT_CONTENT_TOOLS,
  INSERT_TOOL_DEFINITIONS,
} from "./editor-tool-definitions";
import { useInsertRequest } from "./ToolbarDialogs";
import { ToolbarButton } from "./toolbar/ToolbarButton";
import { ToolbarGroup } from "./toolbar/ToolbarGroup";

export function CompactToolbarControls({
  editor,
  mobile = false,
  onLink,
}: {
  editor: Editor;
  mobile?: boolean;
  onLink?: () => void;
}) {
  const requestInsert = useInsertRequest();
  const spoilerActive = editor.isActive("spoiler");
  const textStyle = editor.getAttributes("textStyle") as {
    color?: string;
  };
  const iconClass = mobile ? "[&_svg]:size-5" : "";

  return (
    <div
      className="flex min-w-0 items-center gap-1"
      role="group"
      aria-label="折叠编辑工具"
    >
      <ToolbarButton
        label="加粗"
        active={editor.isActive("bold")}
        mobile={mobile}
        disabled={spoilerActive}
        className={iconClass}
        onClick={cmd(editor, toggleBold)}
      >
        <Bold size={mobile ? 22 : 18} />
      </ToolbarButton>
      <ToolbarGroup label="文字格式" icon={Italic} collapsed mobile={mobile}>
        <DropdownMenuItem
          disabled={spoilerActive}
          onSelect={cmd(editor, toggleItalic)}
        >
          <Italic />
          斜体
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={cmd(editor, toggleUnderline)}>
          <UnderlineIcon />
          下划线
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={spoilerActive}
          onSelect={cmd(editor, clearFormatting)}
        >
          <Eraser />
          清除样式
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={spoilerActive}
          onSelect={() => setFontFamily(editor, "Noto Serif SC Variable")}
        >
          宋体
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={spoilerActive}
          onSelect={() => setFontFamily(editor, "sans-serif")}
        >
          黑体
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setFontSize(editor, "18px")}>
          <span className="text-xs font-bold">18</span>
          字号 18px
        </DropdownMenuItem>
        <div className="border-t border-border p-2">
          <ColorPicker
            value={textStyle.color ?? ""}
            onChange={(color) => setColor(editor, color)}
            compact
            disabled={spoilerActive}
          />
        </div>
      </ToolbarGroup>
      <ToolbarGroup label="段落排版" icon={AlignLeft} collapsed mobile={mobile}>
        <DropdownMenuItem onSelect={cmd(editor, toggleBulletList)}>
          <List />
          无序列表
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={cmd(editor, toggleOrderedList)}>
          <ListOrdered />
          有序列表
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={cmd(editor, toggleBlockquote)}>
          <Quote />
          引用
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTextAlign(editor, "left")}>
          <AlignLeft />
          左对齐
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTextAlign(editor, "center")}>
          <AlignCenter />
          居中
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setTextAlign(editor, "right")}>
          <AlignRight />
          右对齐
        </DropdownMenuItem>
      </ToolbarGroup>
      <ToolbarGroup
        label="插入内容"
        icon={INSERT_CONTENT_TOOLS[0]!.icon}
        collapsed
        mobile={mobile}
      >
        <DropdownMenuItem
          disabled={!onLink}
          {...(onLink ? { onSelect: onLink } : {})}
        >
          <Link2 />
          链接
        </DropdownMenuItem>
        {INSERT_CONTENT_TOOLS.map((definition) => {
          const Icon = definition.icon;
          return (
            <DropdownMenuItem
              key={definition.tool}
              onSelect={() => requestInsert?.(definition.tool)}
            >
              <Icon />
              {definition.label}
            </DropdownMenuItem>
          );
        })}
      </ToolbarGroup>
      <ToolbarGroup label="更多工具" icon={MoreHorizontal} collapsed mobile={mobile}>
        <DropdownMenuItem onSelect={cmd(editor, undo)}>
          <Undo2 />
          撤销
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={cmd(editor, redo)}>
          <Redo2 />
          重做
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleHeading(editor, 1)}>
          <Heading1 />
          一级标题
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => toggleHeading(editor, 2)}>
          <Heading2 />
          二级标题
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => requestInsert?.("comment")}>
          <MessageCirclePlus />
          间贴锚点
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => requestInsert?.("mention")}>
          <AtSign />
          提及用户
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={cmd(editor, toggleSpoiler)}>
          <EyeOff />
          黑幕
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => requestInsert?.("gate")}>
          <UnlockKeyhole />
          回复后可见
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={
            INSERT_TOOL_DEFINITIONS.ungate.isDisabled?.(editor) ?? false
          }
          onSelect={() => requestInsert?.("ungate")}
        >
          <XCircle />
          取消回复可见
        </DropdownMenuItem>
      </ToolbarGroup>
    </div>
  );
}
