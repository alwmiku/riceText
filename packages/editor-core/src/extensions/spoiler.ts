import { Mark } from "@tiptap/core";
import { spoilerMarkSpec } from "@ricetext/document-core";

/** 用于悬停显示与点击切换剧透文本的 Tiptap 标记（规格来自 document-core）。 */
export const Spoiler = Mark.create({
  ...spoilerMarkSpec,
  addCommands() {
    return {
      setSpoiler:
        () =>
        ({ commands }) =>
          commands.setMark(this.name),
      toggleSpoiler:
        () =>
        ({ commands }) =>
          commands.toggleMark(this.name),
      unsetSpoiler:
        () =>
        ({ commands }) =>
          commands.unsetMark(this.name),
    };
  },
});
