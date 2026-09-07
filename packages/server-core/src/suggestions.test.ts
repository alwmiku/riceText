import type { TiptapDocument } from "@ricetext/contracts";
import { diffDocuments, type JSONContent } from "@ricetext/document-core";
import { describe, expect, it } from "vitest";
import { sanitizeDocumentForWrite } from "./documents";
import { mergeSuggestionBatch, validateSuggestionBatch } from "./suggestions";

const chapter: TiptapDocument = {
  type: "doc",
  content: [
    {
      type: "heading",
      attrs: { textAlign: "left", chapterStart: true, level: 2 },
      content: [{ type: "text", text: "Chapter" }],
    },
    {
      type: "paragraph",
      attrs: { textAlign: "left" },
      content: [{ type: "text", text: "Body" }],
    },
  ],
};

describe("suggestion batch attribute compatibility", () => {
  it("accepts a formatting suggestion against a legacy chapter without default indent attributes", () => {
    const before = sanitizeDocumentForWrite(chapter);
    const after = structuredClone(before);
    after.content[1]!.attrs!.firstLineIndent = 2;
    after.content[1]!.attrs!.leftIndent = 4;
    const result = validateSuggestionBatch(chapter, {
      chapterId: "chapter-0",
      beforeContent: before,
      afterContent: after,
      steps: diffDocuments(chapter as JSONContent, after as JSONContent).map(
        (step) => ({ ...step }),
      ),
    });
    expect(result).toEqual(after);
    expect(chapter.content[1]!.attrs).toEqual({ textAlign: "left" });
  });

  it("still rejects snapshots whose actual indentation differs", () => {
    const current = sanitizeDocumentForWrite(chapter);
    const changed = structuredClone(current);
    changed.content[1]!.attrs!.leftIndent = 2;
    expect(
      mergeSuggestionBatch(changed, "chapter-0", current, current),
    ).toBeNull();
  });

  it("still rejects steps that change text outside the declared chapter", () => {
    const current = sanitizeDocumentForWrite({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Book" }],
        },
        ...chapter.content,
      ],
    });
    const changed = structuredClone(current);
    changed.content[0]!.content![0]!.text = "Changed book";
    expect(() =>
      validateSuggestionBatch(current, {
        chapterId: "chapter-0",
        beforeContent: sanitizeDocumentForWrite(chapter),
        afterContent: sanitizeDocumentForWrite(chapter),
        steps: diffDocuments(
          current as JSONContent,
          changed as JSONContent,
        ).map((step) => ({ ...step })),
      }),
    ).toThrow("批量校订 steps 与当前章节修改不一致");
  });
});
