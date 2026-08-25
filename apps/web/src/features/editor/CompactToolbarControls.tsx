import type { Editor } from "@tiptap/react";
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  AtSign,
  Bold,
  Dice5,
  Eraser,
  EyeOff,
  FileText,
  Heading1,
  Heading2,
  ImagePlus,
  Italic,
  Link2,
  List,
  ListOrdered,
  MessageCirclePlus,
  MoreHorizontal,
  Quote,
  Redo2,
  TextQuote,
  Underline as UnderlineIcon,
  Undo2,
  UnlockKeyhole,
  Vote,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { DropdownMenuItem } from "../../components/ui";
import { isContainerNodeActive } from "./commands";
import { toolbarColors, dispatchToolbarInsert } from "./toolbar-constants";
import { ToolbarButton } from "./ToolbarButton";
import { ToolbarGroup } from "./ToolbarGroup";

export function CompactToolbarControls({
  editor,
  mobile = false,
  onLink,
}: {
  editor: Editor;
  mobile?: boolean;
  onLink?: () => void;
}) {
  const spoilerActive = editor.isActive("spoiler");
  const run = (action: (value: Editor) => boolean) => () => action(editor);
  const iconClass = mobile ? "[&_svg]:size-5" : "";
  const insertTools: Array<[string, string, LucideIcon]> = [
    ["image", "图片", ImagePlus],
    ["dice", "骰子", Dice5],
    ["attachment", "附件", FileText],
    ["mention", "提及用户", AtSign],
    ["poll", "投票", Vote],
    ["excerpt", "小说摘录", TextQuote],
  ];

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
        onClick={run((value) => value.chain().focus().toggleBold().run())}
      >
        <Bold size={mobile ? 22 : 18} />
      </ToolbarButton>
      <ToolbarGroup label="文字格式" icon={Italic} collapsed mobile={mobile}>
        <DropdownMenuItem
          disabled={spoilerActive}
          onSelect={run((value) => value.chain().focus().toggleItalic().run())}
        >
          <Italic />
          斜体
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().toggleUnderline().run())}
        >
          <UnderlineIcon />
          下划线
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={spoilerActive}
          onSelect={run((value) =>
            value.chain().focus().unsetAllMarks().clearNodes().run(),
          )}
        >
          <Eraser />
          清除样式
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={spoilerActive}
          onSelect={run((value) =>
            value.chain().focus().setFontFamily("Noto Serif SC Variable").run(),
          )}
        >
          宋体
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={spoilerActive}
          onSelect={run((value) =>
            value.chain().focus().setFontFamily("sans-serif").run(),
          )}
        >
          黑体
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) =>
            value
              .chain()
              .focus()
              .setMark("textStyle", {
                ...value.getAttributes("textStyle"),
                fontSize: "18px",
              })
              .run(),
          )}
        >
          <span className="text-xs font-bold">18</span>
          字号 18px
        </DropdownMenuItem>
        <div className="flex gap-1 border-t border-border p-2">
          {toolbarColors.map((color) => (
            <button
              key={color}
              type="button"
              aria-label={`文字颜色 ${color}`}
              className="size-7 rounded border border-black/10"
              style={{ background: color }}
              onClick={() => editor.chain().focus().setColor(color).run()}
            />
          ))}
        </div>
      </ToolbarGroup>
      <ToolbarGroup label="段落排版" icon={AlignLeft} collapsed mobile={mobile}>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().toggleBulletList().run())}
        >
          <List />
          无序列表
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().toggleOrderedList().run())}
        >
          <ListOrdered />
          有序列表
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().toggleBlockquote().run())}
        >
          <Quote />
          引用
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().setTextAlign("left").run())}
        >
          <AlignLeft />
          左对齐
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().setTextAlign("center").run())}
        >
          <AlignCenter />
          居中
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().setTextAlign("right").run())}
        >
          <AlignRight />
          右对齐
        </DropdownMenuItem>
      </ToolbarGroup>
      <ToolbarGroup label="插入内容" icon={ImagePlus} collapsed mobile={mobile}>
        <DropdownMenuItem
          disabled={!onLink}
          {...(onLink ? { onSelect: onLink } : {})}
        >
          <Link2 />
          链接
        </DropdownMenuItem>
        {insertTools.map(([tool, label, Icon]) => (
          <DropdownMenuItem
            key={tool}
            onSelect={() => dispatchToolbarInsert(editor, tool)}
          >
            <Icon />
            {label}
          </DropdownMenuItem>
        ))}
      </ToolbarGroup>
      <ToolbarGroup label="更多工具" icon={MoreHorizontal} collapsed mobile={mobile}>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().undo().run())}
        >
          <Undo2 />
          撤销
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().redo().run())}
        >
          <Redo2 />
          重做
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) =>
            value.chain().focus().toggleHeading({ level: 1 }).run(),
          )}
        >
          <Heading1 />
          一级标题
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) =>
            value.chain().focus().toggleHeading({ level: 2 }).run(),
          )}
        >
          <Heading2 />
          二级标题
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => dispatchToolbarInsert(editor, "comment")}>
          <MessageCirclePlus />
          间贴锚点
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => dispatchToolbarInsert(editor, "mention")}>
          <AtSign />
          提及用户
        </DropdownMenuItem>
        <DropdownMenuItem
          onSelect={run((value) => value.chain().focus().toggleSpoiler().run())}
        >
          <EyeOff />
          黑幕
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => dispatchToolbarInsert(editor, "gate")}>
          <UnlockKeyhole />
          回复后可见
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!isContainerNodeActive(editor, "replyGate")}
          onSelect={() => dispatchToolbarInsert(editor, "ungate")}
        >
          <XCircle />
          取消回复可见
        </DropdownMenuItem>
      </ToolbarGroup>
    </div>
  );
}
