import { Node } from "@tiptap/core";

/** Tiptap block node whose content is projected according to reply access. */
export const ReplyGate = Node.create({
  name: "replyGate",
  group: "block",
  content: "block+",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      gateId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-gate-id")?.slice(0, 128) ?? "",
      },
      prompt: {
        default: "Reply to view this content",
        parseHTML: (element) =>
          element.getAttribute("data-prompt")?.slice(0, 300) ??
          "Reply to view this content",
      },
    };
  },
  parseHTML() {
    return [{ tag: 'section[data-node-type="reply-gate"]' }];
  },
  renderHTML({ node }) {
    return [
      "section",
      {
        class: "rt-reply-gate",
        "data-node-type": "reply-gate",
        "data-gate-id": String(node.attrs.gateId),
        "data-prompt": String(node.attrs.prompt),
      },
      0,
    ];
  },
  addCommands() {
    return {
      insertReplyGate:
        (attrs, content = [{ type: "paragraph" }]) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs, content }),
    };
  },
});
