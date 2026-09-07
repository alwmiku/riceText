import { Extension } from "@tiptap/core";

export const MAX_PARAGRAPH_INDENT = 20;
export type IndentAttribute = "firstLineIndent" | "leftIndent";

export function isParagraphIndent(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_PARAGRAPH_INDENT &&
    value % 2 === 0
  );
}

function parseIndent(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)em$/u);
  const amount = match ? Number(match[1]) : 0;
  return isParagraphIndent(amount) ? amount : 0;
}

export const ParagraphIndentAttributes = Extension.create({
  name: "paragraphIndent",
  addGlobalAttributes() {
    return [
      {
        types: ["paragraph", "heading"],
        attributes: {
          firstLineIndent: {
            default: 0,
            parseHTML: (element) => parseIndent(element.style.textIndent),
            renderHTML: (attrs) =>
              isParagraphIndent(attrs.firstLineIndent) &&
              attrs.firstLineIndent > 0
                ? { style: `text-indent: ${attrs.firstLineIndent}em` }
                : {},
          },
          leftIndent: {
            default: 0,
            parseHTML: (element) => parseIndent(element.style.marginLeft),
            renderHTML: (attrs) =>
              isParagraphIndent(attrs.leftIndent) && attrs.leftIndent > 0
                ? { style: `margin-left: ${attrs.leftIndent}em` }
                : {},
          },
        },
      },
    ];
  },
});
