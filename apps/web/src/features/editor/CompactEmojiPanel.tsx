import type { Editor } from "@tiptap/react";
import { DismissableLayer } from "radix-ui/internal";
import { useState } from "react";
import type { EmojiCatalogEntry } from "@ricetext/contracts";
import { DropdownMenuItem } from "../../components/ui";
import { EmojiPicker } from "../../components/ui/emoji-picker";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/popover";
import { insertEmojiEntry } from "./emoji-insert";

/**
 * 折叠菜单「插入内容」里就地展开的表情面板。
 *
 * 与折叠拾色器同一套手法：菜单项只负责把弹层打开（`event.preventDefault()`
 * 阻止菜单关闭），弹层锚点固定在视口上部，并用 DismissableLayer branch 把
 * 面板注册进菜单的关闭层级，这样在面板内点击、输入都不会被判定为「点到菜单外」。
 */
export function CompactEmojiPanel({
  editor,
  mobile = false,
}: {
  editor: Editor;
  mobile?: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <DropdownMenuItem
        {...(mobile ? { className: "min-h-11" } : {})}
        onSelect={(event: Event) => {
          event.preventDefault();
          setOpen(true);
        }}
      >
        表情
      </DropdownMenuItem>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverAnchor asChild>
          <span className="pointer-events-none fixed left-1/2 top-[24vh] h-0 w-0" />
        </PopoverAnchor>
        <PopoverContent
          side="bottom"
          align="center"
          position="fixed"
          className="z-[70] w-auto p-1.5"
          onInteractOutside={(event) => {
            // setFocus 会 focus 编辑器，只拦截 focusin 来源的关闭。
            if (event.detail.originalEvent.type === "focusin") event.preventDefault();
          }}
        >
          <DismissableLayer.Branch className="p-0">
            <EmojiPicker
              onPick={(entry: EmojiCatalogEntry) => {
                insertEmojiEntry(editor, entry);
              }}
            />
          </DismissableLayer.Branch>
        </PopoverContent>
      </Popover>
    </>
  );
}
