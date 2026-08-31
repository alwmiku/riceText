import type { Editor } from "@tiptap/react";
import { DismissableLayer } from "radix-ui/internal";
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
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "../../components/ui/popover";
import {
  ColorPicker,
  persistLastColor,
  useLastColor,
} from "../../components/ui/color-picker";
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
  const [colorOpen, setColorOpen] = useState(false);
  const lastColor = useLastColor();
  const textStyle = editor.getAttributes("textStyle") as {
    fontSize?: string;
    fontFamily?: string;
  };
  const iconClass = mobile ? "[&_svg]:size-5" : "";

  return (
    // 独立取色弹层的 Popover 根：不渲染 DOM，仅提供上下文；面板内容锚定
    // 在菜单内「颜色」项上，但根/内容都不受菜单生命周期影响（菜单重挂载时
    // 弹层草稿状态不丢）。
    <Popover open={colorOpen} onOpenChange={setColorOpen}>
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
        {/* 颜色：色块可单独点击直接应用当前工作色（随取色面板草稿实时同步）；
            「颜色」项点击打开独立取色弹层。本行即取色弹层的 PopoverAnchor，
            面板贴着这一行弹出（同字体/字号子菜单的方向感）；弹层内容独立于
            菜单生命周期（Radix 子菜单拖动时会关闭重挂载，导致 SV 取色后
            跳回旧色）。 */}
        <PopoverAnchor asChild>
          <div className="flex items-stretch" role="none">
            <button
              type="button"
              aria-label="应用文字颜色"
              disabled={spoilerActive}
              onClick={() => setColor(editor, lastColor)}
              className="flex min-h-9 shrink-0 items-center gap-2 rounded-l px-2.5 text-sm hover:bg-muted disabled:pointer-events-none disabled:opacity-45"
            >
              <span
                aria-hidden="true"
                className="h-4 w-4 rounded-sm border border-black/15"
                style={{ background: lastColor }}
              />
            </button>
            <DropdownMenuItem
              className="flex-1 rounded-l-none gap-1.5 pr-2.5 [&_svg]:size-3.5"
              onSelect={(event) => {
                // 阻止菜单关闭，让独立取色弹层接管
                event.preventDefault();
                setColorOpen(true);
              }}
            >
              颜色
            </DropdownMenuItem>
          </div>
        </PopoverAnchor>
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
      {/* 独立取色弹层：锚定菜单内「颜色」行（PopoverAnchor asChild）。移动端
          菜单向上展开，面板居中弹在「颜色」行正上方（行保持可见可点）；
          桌面折叠栏菜单向下展开，面板侧向弹出不遮菜单，Radix 碰撞规避兜底。
          Popover 根与内容都在菜单树之外，拖动 SV/滑杆时不会随菜单关闭而重挂载。
          注意不要改回「fixed 视口锚点」：移动端底部栏 backdrop-blur 会成为
          fixed 的包含块，锚点落到视口外，面板会被翻转挤出且截断。 */}
      <PopoverContent
        side={mobile ? "top" : "right"}
        align={mobile ? "center" : "start"}
        position="fixed"
        className="z-[70] w-auto p-0"
        onInteractOutside={(event) => {
          // 菜单关闭时 Radix 会把焦点还给菜单按钮（焦点移出弹层），
          // 新版 Radix 将 focusin 视为 interact outside 而关闭弹层；
          // 只拦截 focusin 来源的关闭，点击弹层外部（pointerdown）仍关闭。
          if (event.detail.originalEvent.type === "focusin") {
            event.preventDefault();
          }
        }}
      >
        {/* 把整个弹层注册为「文字格式」菜单（modal DropdownMenu）的
           DismissableLayer branch：在面板内按下/聚焦（SV 矩阵、滑杆、Hex、
           已存色块）不再被 Radix 判定为「点击菜单外部」，斜体菜单保持打开。
           内边距随之移入 branch，保证弹层整个面板都在 branch 内。 */}
        <DismissableLayer.Branch className="p-1.5">
          <ColorPicker
            onChange={(color) => {
              persistLastColor(color);
              setColor(editor, color);
              setColorOpen(false);
            }}
            direct
            saturationCompact
            disabled={spoilerActive}
            className="w-[min(236px,calc(100vw-24px))]"
          />
        </DismissableLayer.Branch>
      </PopoverContent>
    </Popover>
  );
}
