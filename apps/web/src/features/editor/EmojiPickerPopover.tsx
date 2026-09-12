import { Smile } from "lucide-react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { Editor } from "@tiptap/react";
import type { EmojiCatalogEntry } from "@ricetext/contracts";
import { EmojiPicker } from "../../components/ui/emoji-picker";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover";
import { cn } from "../../lib/utils";
import { insertEmojiEntry } from "./emoji-insert";

/**
 * 工具栏「表情」入口：按钮 + 拾取面板。
 *
 * 交互细节与拾色器保持一致：
 * - 所有会获得焦点的元素都阻止默认的 mousedown，避免编辑器丢失选区；
 * - 面板 z-[70] 高于选区浮动工具栏（z-60），有选区时也能点到；
 * - `onInteractOutside` 只拦截 focusin 来源的关闭——插入表情会 focus 编辑器，
 *   否则点一次就被判成「点到面板外」而关闭。
 */
export function EmojiPickerPopover({
  editor,
  label = "表情",
  disabled = false,
  align = "start",
  side = "bottom",
  triggerClassName,
  triggerOnMouseDown,
  open: controlledOpen,
  onOpenChange,
}: {
  editor: Editor;
  /** 触发按钮的可访问名称。 */
  label?: string;
  disabled?: boolean;
  align?: "start" | "center" | "end";
  side?: "top" | "right" | "bottom" | "left";
  triggerClassName?: string;
  /** 选区浮动工具栏用它保住选区。 */
  triggerOnMouseDown?: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  /** 受控打开状态；右键菜单等没有可见触发按钮的宿主用它延迟打开面板。 */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Popover
      {...(controlledOpen === undefined ? {} : { open: controlledOpen })}
      {...(onOpenChange ? { onOpenChange } : {})}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={label}
          aria-haspopup="dialog"
          title={label}
          disabled={disabled}
          onMouseDown={triggerOnMouseDown}
          className={cn(
            "inline-flex shrink-0 items-center justify-center rounded-md text-[#54616b] hover:bg-muted disabled:pointer-events-none disabled:opacity-45",
            triggerClassName,
          )}
        >
          <Smile size={16} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align={align}
        side={side}
        position="fixed"
        className="z-[70] w-auto p-1.5"
        onInteractOutside={(event) => {
          if (event.detail.originalEvent.type === "focusin") event.preventDefault();
        }}
      >
        <EmojiPicker
          onPick={(entry: EmojiCatalogEntry) => {
            insertEmojiEntry(editor, entry);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
