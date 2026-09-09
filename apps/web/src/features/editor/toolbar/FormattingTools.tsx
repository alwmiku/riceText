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
  Segmented,
} from "../../../components/ui";
import { Popover, PopoverContent, PopoverTrigger } from "../../../components/ui/popover";
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
    <div className="flex w-full min-w-0 flex-col gap-2 p-2" role="group" aria-label="缩进设置">
      <div className="flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted-foreground">缩进范围</span>
        <fieldset disabled={!editor.isEditable} onMouseDown={(event) => event.preventDefault()}>
          <Segmented
            ariaLabel="缩进范围"
            value={wholeDocument ? "chapter" : "selection"}
            options={[
              { value: "selection", label: editor.state.selection.empty ? "当前段落" : "选中段落" },
              { value: "chapter", label: "本章全部" },
            ]}
            onChange={(value) => onWholeDocumentChange(value === "chapter")}
          />
        </fieldset>
        <p className="text-[11px] leading-4 text-muted-foreground">
          {wholeDocument ? "调整本章全部段落的缩进" : "仅调整当前或选中段落的缩进"}
        </p>
      </div>
      {(
        [
          ["firstLineIndent", "首行缩进", ArrowLeftToLine, ArrowRightFromLine],
          ["leftIndent", "整段缩进", IndentDecrease, IndentIncrease],
        ] as const
      ).map(([attribute, label, Decrease, Increase]) => (
        <div key={attribute} className="grid grid-cols-[1fr_auto] items-center gap-2">
          <span className="text-sm">{label}</span>
          <div className="flex gap-1">
            <ToolbarButton
              label={`减少${label}`}
              className="size-9"
              disabled={!editor.can().adjustIndent(attribute, -2, wholeDocument)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().adjustIndent(attribute, -2, wholeDocument).run()}
            >
              <Decrease />
            </ToolbarButton>
            <ToolbarButton
              label={`增加${label}`}
              className="size-9"
              disabled={!editor.can().adjustIndent(attribute, 2, wholeDocument)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => editor.chain().adjustIndent(attribute, 2, wholeDocument).run()}
            >
              <Increase />
            </ToolbarButton>
          </div>
        </div>
      ))}
      <p className="text-[11px] leading-4 text-muted-foreground">每次增减 2 字，不影响列表和对齐</p>
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
        className="w-[216px] max-w-[calc(100vw-24px)]"
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
      disabled={!editor.isEditable || (mode === "off" && !editor.can().startFormatPainter())}
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
        disabled={!editor.isEditable || (mode === "off" && !editor.can().startFormatPainter())}
      >
        <Paintbrush />
        格式刷{mode !== "off" && <Check />}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <div role="group" aria-label="格式刷操作">
          <DropdownMenuItem onSelect={() => editor.commands.startFormatPainter("once")}>
            <Paintbrush />
            单次格式刷
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => editor.commands.startFormatPainter("continuous")}>
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
