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
  Quote,
  Redo2,
  TextQuote,
  Underline as UnderlineIcon,
  Undo2,
  UnlockKeyhole,
  Vote,
  XCircle,
} from "lucide-react";
import { ColorPickerPopover } from "../../../components/ui/color-picker";
import { cmd } from "../commands";
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
} from "../editor-actions";
import {
  FONT_FAMILIES,
  FONT_SIZES,
  INSERT_TOOL_DEFINITIONS,
} from "../editor-tool-definitions";
import { useInsertRequest } from "./ToolbarDialogs";
import { ToolbarButton } from "./ToolbarButton";

const groupClassName =
  "inline-flex items-center gap-0.5 border-r border-[#e3e7ea] pr-[5px] mr-[3px] last:border-r-0";

/** 撤销/重做分组。 */
export function UndoRedoGroup({ editor }: { editor: Editor }) {
  return (
    <span className={groupClassName}>
      <ToolbarButton
        label="撤销"
        onClick={cmd(editor, undo)}
        disabled={!editor.can().undo()}
      >
        <Undo2 size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="重做"
        onClick={cmd(editor, redo)}
        disabled={!editor.can().redo()}
      >
        <Redo2 size={16} />
      </ToolbarButton>
    </span>
  );
}

/** 文字格式分组：粗体/斜体/下划线/清除样式、标题、字号/字体/颜色。 */
export function TextFormatGroup({
  editor,
  condensed,
}: {
  editor: Editor;
  condensed: boolean;
}) {
  const spoilerActive = editor.isActive("spoiler");
  const textStyle = editor.getAttributes("textStyle") as {
    color?: string;
    fontSize?: string;
    fontFamily?: string;
  };
  return (
    <>
      <span className={groupClassName}>
        <ToolbarButton
          label="加粗"
          active={editor.isActive("bold")}
          disabled={spoilerActive}
          onClick={cmd(editor, toggleBold)}
        >
          <Bold size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="斜体"
          active={editor.isActive("italic")}
          disabled={spoilerActive}
          onClick={cmd(editor, toggleItalic)}
        >
          <Italic size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="下划线"
          active={editor.isActive("underline")}
          onClick={cmd(editor, toggleUnderline)}
        >
          <UnderlineIcon size={16} />
        </ToolbarButton>
        <ToolbarButton
          label="清除样式"
          onClick={cmd(editor, clearFormatting)}
        >
          <Eraser size={16} />
        </ToolbarButton>
        {!condensed && (
          <>
            <ToolbarButton
              label="一级标题"
              active={editor.isActive("heading", { level: 1 })}
              onClick={() => toggleHeading(editor, 1)}
            >
              <Heading1 size={16} />
            </ToolbarButton>
            <ToolbarButton
              label="二级标题"
              active={editor.isActive("heading", { level: 2 })}
              onClick={() => toggleHeading(editor, 2)}
            >
              <Heading2 size={16} />
            </ToolbarButton>
          </>
        )}
      </span>
      {!condensed && (
        <span className={groupClassName}>
          <select
            aria-label="字号"
            disabled={spoilerActive}
            className="h-8 w-[72px] rounded border border-input bg-white px-1 text-xs"
            value={textStyle.fontSize ?? "16px"}
            onChange={(event) => setFontSize(editor, event.target.value)}
          >
            {FONT_SIZES.map((fontSize) => (
              <option key={fontSize}>{fontSize}</option>
            ))}
          </select>
          <select
            aria-label="字体"
            disabled={spoilerActive}
            className="h-8 w-[86px] rounded border border-input bg-white px-1 text-xs"
            value={textStyle.fontFamily ?? ""}
            onChange={(event) => setFontFamily(editor, event.target.value)}
          >
            {FONT_FAMILIES.map((font) => (
              <option key={font.value} value={font.value}>
                {font.label}
              </option>
            ))}
          </select>
          {/* 拾色器自持记忆色（上次使用的颜色），不随选区文字颜色同步。 */}
          <ColorPickerPopover
            onChange={(color) => setColor(editor, color)}
            label="文字颜色"
            disabled={spoilerActive}
            triggerClassName="h-8"
          />
        </span>
      )}
    </>
  );
}

/** 段落排版分组：列表、引用与对齐。 */
export function ParagraphGroup({
  editor,
  condensed,
}: {
  editor: Editor;
  condensed: boolean;
}) {
  return (
    <>
      {!condensed && (
        <span className={groupClassName}>
          <ToolbarButton
            label="无序列表"
            active={editor.isActive("bulletList")}
            onClick={cmd(editor, toggleBulletList)}
          >
            <List size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="有序列表"
            active={editor.isActive("orderedList")}
            onClick={cmd(editor, toggleOrderedList)}
          >
            <ListOrdered size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="引用"
            active={editor.isActive("blockquote")}
            onClick={cmd(editor, toggleBlockquote)}
          >
            <Quote size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="左对齐"
            active={editor.isActive({ textAlign: "left" })}
            onClick={() => setTextAlign(editor, "left")}
          >
            <AlignLeft size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="居中"
            active={editor.isActive({ textAlign: "center" })}
            onClick={() => setTextAlign(editor, "center")}
          >
            <AlignCenter size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="右对齐"
            active={editor.isActive({ textAlign: "right" })}
            onClick={() => setTextAlign(editor, "right")}
          >
            <AlignRight size={16} />
          </ToolbarButton>
        </span>
      )}
    </>
  );
}

/** 业务节点分组：链接、图片/骰子/附件与间贴/黑幕/摘录/回复可见/投票。 */
export function BusinessNodeGroup({
  editor,
  condensed,
}: {
  editor: Editor;
  condensed: boolean;
}) {
  const requestInsert = useInsertRequest();
  const spoilerActive = editor.isActive("spoiler");
  const comment = INSERT_TOOL_DEFINITIONS.comment;
  const gate = INSERT_TOOL_DEFINITIONS.gate;
  const ungate = INSERT_TOOL_DEFINITIONS.ungate;
  const poll = INSERT_TOOL_DEFINITIONS.poll;
  const pollActive = poll.isActive?.(editor) ?? false;
  const replyGateActive = gate.isActive?.(editor) ?? false;

  return (
    <span className={groupClassName}>
      {!condensed && (
        <ToolbarButton
          label="链接"
          active={editor.isActive("link")}
          onClick={() => requestInsert?.("link")}
        >
          <Link2 size={16} />
        </ToolbarButton>
      )}
      <ToolbarButton
        label="图片"
        active={INSERT_TOOL_DEFINITIONS.image.isActive?.(editor) ?? false}
        onClick={() => requestInsert?.("image")}
      >
        <ImagePlus size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="骰子"
        active={INSERT_TOOL_DEFINITIONS.dice.isActive?.(editor) ?? false}
        onClick={() => requestInsert?.("dice")}
      >
        <Dice5 size={16} />
      </ToolbarButton>
      <ToolbarButton
        label="附件"
        active={INSERT_TOOL_DEFINITIONS.attachment.isActive?.(editor) ?? false}
        onClick={() => requestInsert?.("attachment")}
      >
        <FileText size={16} />
      </ToolbarButton>
      {!condensed && (
        <>
          <ToolbarButton
            label="间贴锚点"
            active={comment.isActive?.(editor) ?? false}
            disabled={comment.isDisabled?.(editor) ?? false}
            onClick={() => {
              if (comment.isDisabled?.(editor)) return;
              requestInsert?.("comment");
            }}
          >
            <MessageCirclePlus size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="@ 用户"
            active={INSERT_TOOL_DEFINITIONS.mention.isActive?.(editor) ?? false}
            onClick={() => requestInsert?.("mention")}
          >
            <AtSign size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="黑幕"
            active={spoilerActive}
            onClick={cmd(editor, toggleSpoiler)}
          >
            <EyeOff size={16} />
          </ToolbarButton>
        </>
      )}
      {!condensed && (
        <>
          <ToolbarButton
            label="小说摘录"
            active={INSERT_TOOL_DEFINITIONS.excerpt.isActive?.(editor) ?? false}
            onClick={() => requestInsert?.("excerpt")}
          >
            <TextQuote size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="回复后可见"
            active={replyGateActive}
            onClick={() => requestInsert?.("gate")}
          >
            <UnlockKeyhole size={16} />
          </ToolbarButton>
          <ToolbarButton
            label="取消回复可见"
            disabled={ungate.isDisabled?.(editor) ?? false}
            onClick={() => requestInsert?.("ungate")}
          >
            <XCircle size={16} />
          </ToolbarButton>
          <ToolbarButton
            label={pollActive ? "编辑投票" : "投票"}
            active={pollActive}
            onClick={() => requestInsert?.("poll")}
          >
            <Vote size={16} />
          </ToolbarButton>
        </>
      )}
    </span>
  );
}
