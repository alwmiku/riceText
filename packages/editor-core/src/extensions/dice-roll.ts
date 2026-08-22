import { Node } from "@tiptap/core";

import { parseInteger, parseJsonArray } from "./helpers.js";

/** Tiptap inline atom for an immutable server-generated dice result. */
export const DiceRoll = Node.create({
  name: "diceRoll",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  marks: "_",
  addAttributes() {
    return {
      rollId: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-roll-id")?.slice(0, 128) ?? "",
      },
      expression: {
        default: "",
        parseHTML: (element) =>
          element.getAttribute("data-expression")?.slice(0, 80) ?? "",
      },
      rolls: {
        default: [],
        parseHTML: (element) =>
          parseJsonArray(element.getAttribute("data-rolls"))
            .slice(0, 100)
            .map(Number)
            .filter(Number.isFinite),
      },
      total: {
        default: 0,
        parseHTML: (element) =>
          parseInteger(
            element.getAttribute("data-total"),
            0,
            -100_000_000,
            100_000_000,
          ),
      },
      rerollOf: {
        default: null,
        parseHTML: (element) =>
          element.getAttribute("data-reroll-of")?.slice(0, 128) ?? null,
      },
    };
  },
  parseHTML() {
    return [{ tag: 'span[data-node-type="dice-roll"]' }];
  },
  renderHTML({ node }) {
    return [
      "span",
      {
        class: "rt-dice-roll",
        "data-node-type": "dice-roll",
        "data-roll-id": String(node.attrs.rollId),
        "data-expression": String(node.attrs.expression),
        "data-rolls": JSON.stringify(node.attrs.rolls),
        "data-total": String(node.attrs.total),
        "data-reroll-of": node.attrs.rerollOf
          ? String(node.attrs.rerollOf)
          : "",
        contenteditable: "false",
      },
      `${String(node.attrs.expression)} = ${String(node.attrs.total)}`,
    ];
  },
  addCommands() {
    return {
      insertDiceRoll:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});
