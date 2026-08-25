import { Node } from "@tiptap/core";
import { novelExcerptNodeSpec } from "@ricetext/document-core";

/** 用于可搜索、带来源标注的小说文本的 Tiptap 块节点（规格来自 document-core）。 */
export const NovelExcerpt = Node.create({
  ...novelExcerptNodeSpec,
  addCommands() {
    return {
      insertNovelExcerpt:
        (attrs, content = [{ type: "paragraph" }]) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs, content }),
    };
  },
});
