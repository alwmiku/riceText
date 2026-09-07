import { getFormatPainterState } from "@ricetext/editor-core";
import type { Editor } from "@tiptap/react";
import {
  ArrowLeftToLine,
  ArrowRightFromLine,
  Check,
  IndentDecrease,
  IndentIncrease,
  Paintbrush,
  Pin,
  X,
} from "lucide-react";
import {
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from "../../../components/ui";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../../components/ui/popover";
import { ToolbarButton } from "./ToolbarButton";

export interface IndentControlsProps {
  editor: Editor;
  wholeDocument: boolean;
  onWholeDocumentChange: (value: boolean) => void;
}

export function IndentControls({
  editor,
  wholeDocument,
  onWholeDocumentChange,
}: IndentControlsProps) {
  return (
    <div
      className="flex w-60 max-w-full flex-col gap-2 p-2"
      role="group"
      aria-label="缩进设置"
    >
      {(
        [
          ["firstLineIndent", "首行缩进", ArrowLeftToLine, ArrowRightFromLine],
          ["leftIndent", "整段缩进", IndentDecrease, IndentIncrease],
        ] as const
      ).map(([attribute, label, Decrease, Increase]) => (
        <div
          key={attribute}
          className="flex items-center justify-between gap-3"
        >
          <span className="text-sm">{label}</span>
          <div className="flex gap-1">
            <ToolbarButton
              label={`减少${label}`}
              disabled={
                !editor.can().adjustIndent(attribute, -2, wholeDocument)
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                editor.chain().adjustIndent(attribute, -2, wholeDocument).run()
              }
            >
              <Decrease />
            </ToolbarButton>
            <ToolbarButton
              label={`增加${label}`}
              disabled={!editor.can().adjustIndent(attribute, 2, wholeDocument)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                editor.chain().adjustIndent(attribute, 2, wholeDocument).run()
              }
            >
              <Increase />
            </ToolbarButton>
          </div>
        </div>
      ))}
      <label className="flex min-h-8 cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={wholeDocument}
          disabled={!editor.isEditable}
          onChange={(event) => onWholeDocumentChange(event.target.checked)}
        />
        应用到全文
      </label>
    </div>
  );
}

export function IndentPopover(props: IndentControlsProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <ToolbarButton
          label="缩进设置"
          disabled={!props.editor.isEditable}
          onMouseDown={(event) => event.preventDefault()}
        >
          <IndentIncrease />
        </ToolbarButton>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <IndentControls {...props} />
      </PopoverContent>
    </Popover>
  );
}

export function FormatPainterButton({ editor }: { editor: Editor }) {
  const mode = getFormatPainterState(editor).mode;
  return (
    <ToolbarButton
      label={mode === "continuous" ? "格式刷（连续）" : "格式刷"}
      active={mode !== "off"}
      disabled={
        !editor.isEditable ||
        (mode === "off" && !editor.can().startFormatPainter())
      }
      onKeyDown={(event) => {
        if (event.key === "Escape" && mode !== "off") {
          event.preventDefault();
          editor.commands.stopFormatPainter();
        }
      }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={(event) => {
        if (event.detail > 1) return;
        if (mode === "off") editor.commands.startFormatPainter();
        else editor.commands.stopFormatPainter();
      }}
      onDoubleClick={() => editor.commands.startFormatPainter("continuous")}
    >
      {mode === "continuous" ? <Pin /> : <Paintbrush />}
    </ToolbarButton>
  );
}

export function FormatPainterMenu({ editor }: { editor: Editor }) {
  const mode = getFormatPainterState(editor).mode;
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        disabled={
          !editor.isEditable ||
          (mode === "off" && !editor.can().startFormatPainter())
        }
      >
        <Paintbrush />
        格式刷{mode !== "off" && <Check />}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <div role="group" aria-label="格式刷操作">
          <DropdownMenuItem
            onSelect={() => editor.commands.startFormatPainter("once")}
          >
            <Paintbrush />
            单次格式刷
          </DropdownMenuItem>
          <DropdownMenuItem
            onSelect={() => editor.commands.startFormatPainter("continuous")}
          >
            <Pin />
            连续格式刷
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={!editor.can().applyFormatPainter()}
            onSelect={() => editor.chain().focus().applyFormatPainter().run()}
          >
            <Check />
            应用格式
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={mode === "off"}
            onSelect={() => editor.commands.stopFormatPainter()}
          >
            <X />
            退出格式刷
          </DropdownMenuItem>
        </div>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
