import { Node } from "@tiptap/core";
import { diceRollNodeSpec } from "@ricetext/document-core";

/** 用于服务端生成的不可变骰子结果的 Tiptap 行内原子节点（规格来自 document-core）。 */
export const DiceRoll = Node.create({
  ...diceRollNodeSpec,
  addCommands() {
    return {
      insertDiceRoll:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
