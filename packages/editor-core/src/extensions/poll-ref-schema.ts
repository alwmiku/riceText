import { Node } from "@tiptap/core";
import { pollRefNodeSpec } from "@ricetext/document-core";

/** Canonical persisted poll reference without an editor React NodeView. */
export const PollRefSchema = Node.create({
  ...pollRefNodeSpec,
  addCommands() {
    return {
      insertPollRef:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
