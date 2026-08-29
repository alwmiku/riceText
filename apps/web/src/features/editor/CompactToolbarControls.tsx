import type { Editor } from "@tiptap/react";
import { useState } from "react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AtSign,
  Bold,
  Check,
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
import { cn } from "../../lib/utils";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../../components/ui";
import { ColorPicker, loadLastColor } from "../../components/ui/color-picker";
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
  FONT_FAMILIES,
  FONT_SIZES,
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
  const [lastColor, setLastColor] = useState(loadLastColor);
  const textStyle = editor.getAttributes("textStyle") as {
    fontSize?: string;
    fontFamily?: string;
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
        {/* 字体：可点击子菜单（shadcn Context Menu 风格），避免平铺占位 */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={spoilerActive}>
            字体
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {FONT_FAMILIES.map((font) => (
              <DropdownMenuItem
                key={font.value}
                className={cn(
                  textStyle.fontFamily === font.value && "bg-muted font-semibold",
                )}
                onSelect={() => setFontFamily(editor, font.value)}
              >
                {font.label}
                {textStyle.fontFamily === font.value && (
                  <Check size={14} className="ml-auto" aria-hidden="true" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {/* 字号：可点击子菜单 */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>字号</DropdownMenuSubTrigger>
          <DropdownMenuSubContent>
            {FONT_SIZES.map((fontSize) => (
              <DropdownMenuItem
                key={fontSize}
                className={cn(
                  textStyle.fontSize === fontSize && "bg-muted font-semibold",
                )}
                onSelect={() => setFontSize(editor, fontSize)}
              >
                {fontSize}
                {textStyle.fontSize === fontSize && (
                  <Check size={14} className="ml-auto" aria-hidden="true" />
                )}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        {/* 文字颜色：色块可单独点击直接应用；右侧箭头展开完整选色面板（与桌面一致） */}
        <div className="flex items-stretch" role="none">
          <button
            type="button"
            aria-label="应用文字颜色"
            disabled={spoilerActive}
            onClick={() => {
              setLastColor(lastColor);
              setColor(editor, lastColor);
            }}
            className="flex min-h-9 shrink-0 items-center gap-2 rounded-l px-2.5 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
          >
            <span
              aria-hidden="true"
              className="h-4 w-4 rounded-sm border border-black/15"
              style={{ background: lastColor }}
            />
          </button>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={spoilerActive} className="flex-1 rounded-l-none">
              文字颜色
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent
              className="w-auto p-1.5"
              // 移动端屏幕窄：子菜单从触发器右侧展开易超出视口，改从下方展开
              {...(mobile ? { side: "bottom", align: "start" } : {})}
            >
              <ColorPicker
                onChange={(color) => {
                  setLastColor(color);
                  setColor(editor, color);
                }}
                direct
                disabled={spoilerActive}
                className="w-[min(236px,calc(100vw-24px))]"
              />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
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
