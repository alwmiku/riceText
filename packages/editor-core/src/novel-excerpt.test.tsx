import "@testing-library/jest-dom/vitest";
import { Editor, type JSONContent } from "@tiptap/core";
import { EditorContent } from "@tiptap/react";
import type { NovelExcerptAttributes } from "@ricetext/document-core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { editorExtensions } from "./extensions.js";
import { sanitizeDocument, validateDocument } from "./sanitize.js";
import { RichTextViewer } from "./viewer.js";

const variants = ["fanqie", "qidian", "sfacg", "ciweimao"];
const historicalVariants = ["desktop-book", "mobile-book", "forum-evidence", "unknown", undefined];
function document(variant: unknown): JSONContent {
  return {
    type: "doc",
    content: [
      {
        type: "novelExcerpt",
        attrs: {
          variant,
          bookTitle: "Book <script>",
          chapterTitle: "Chapter 2",
          author: "Author",
          sourceUrl: "https://example.com/chapter",
        },
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "First paragraph", marks: [{ type: "bold" }] }],
          },
          { type: "paragraph", content: [{ type: "text", text: "Second paragraph" }] },
        ],
      },
    ],
  };
}

describe("reader excerpts", () => {
  it.each(variants)(
    "preserves %s through sanitization and HTML without duplicating metadata",
    (variant) => {
      const content = sanitizeDocument(document(variant));
      expect(content.content?.[0]?.attrs?.variant).toBe(variant);
      const editor = new Editor({ extensions: editorExtensions(), content });
      const html = editor.getHTML();
      expect(html).toContain("Book &lt;script&gt;");
      expect(html).toContain('class="rt-novel-excerpt__content"');
      const restored = new Editor({ extensions: editorExtensions(), content: html });
      expect(restored.getJSON()).toEqual(editor.getJSON());
      expect(restored.state.doc.textContent).toBe("First paragraphSecond paragraph");
      restored.destroy();
      editor.destroy();
    },
  );

  it.each(variants)("still reads legacy direct paragraph HTML for %s", (variant) => {
    const editor = new Editor({
      extensions: editorExtensions(),
      content:
        '<aside data-node-type="novel-excerpt" data-variant="' +
        variant +
        '" data-book-title="Legacy"><p>Original</p></aside>',
    });
    expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({ bookTitle: "Legacy", variant });
    expect(editor.state.doc.textContent).toBe("Original");
    editor.destroy();
  });

  it.each(historicalVariants)(
    "normalizes historical JSON, HTML and insertion variant %s without losing text or source",
    (variant) => {
      const original = document(variant);
      const validation = validateDocument(original);
      expect(validation.issues).toEqual([]);
      const safe = validation.document;
      expect(safe.content?.[0]?.attrs).toMatchObject({
        variant: "fanqie",
        bookTitle: "Book <script>",
        chapterTitle: "Chapter 2",
        author: "Author",
        sourceUrl: "https://example.com/chapter",
      });
      expect(safe.content?.[0]?.content).toEqual(
        sanitizeDocument(document("fanqie")).content?.[0]?.content,
      );
      expect(original.content?.[0]?.attrs?.variant).toBe(variant);
      const attr = variant === undefined ? "" : ' data-variant="' + variant + '"';
      const editor = new Editor({
        extensions: editorExtensions(),
        content:
          '<aside data-node-type="novel-excerpt"' +
          attr +
          ' data-book-title="Archive" data-chapter-title="Chapter" data-author="Writer" data-source-url="https://example.com/original"><header>Old heading</header><div class="rt-novel-excerpt__content"><p><strong>Original</strong></p><p>Second</p></div><footer>Old footer</footer></aside>',
      });
      try {
        expect(editor.getJSON().content?.[0]?.attrs).toMatchObject({
          variant: "fanqie",
          bookTitle: "Archive",
          chapterTitle: "Chapter",
          author: "Writer",
          sourceUrl: "https://example.com/original",
        });
        expect(editor.state.doc.textContent).toBe("OriginalSecond");
        expect(
          (editor.getJSON() as JSONContent).content?.[0]?.content?.[0]?.content?.[0]?.marks,
        ).toEqual([{ type: "bold" }]);
        expect(editor.getHTML()).toContain('data-variant="fanqie"');
        expect(editor.getHTML()).not.toContain("Old footer");
        editor.commands.setContent("<p></p>");
        editor.commands.insertNovelExcerpt(
          { ...original.content![0]!.attrs } as NovelExcerptAttributes,
          original.content![0]!.content,
        );
        expect(editor.getJSON().content?.[0]?.attrs?.variant).toBe("fanqie");
        expect(editor.state.doc.textContent).toBe("First paragraphSecond paragraph");
      } finally {
        editor.destroy();
      }
    },
  );

  it("renders raw historical node attrs through the shared fallback without rewriting the document", async () => {
    const editor = new Editor({
      extensions: editorExtensions(),
      content: document("forum-evidence"),
    });
    const view = render(<EditorContent editor={editor} />);
    try {
      expect(await screen.findByText("《Book <script>》")).toBeVisible();
      const excerpt = view.container.querySelector(".rt-novel-excerpt");
      expect(excerpt).toHaveAttribute("data-variant", "fanqie");
      expect(excerpt).toHaveAttribute("data-empty-bubble", "false");
      expect(excerpt?.querySelector(".rt-reader-header-label")).toHaveTextContent("00:24得991金币");
      expect(excerpt?.querySelector(".rt-reader-book-title a")).toHaveAttribute(
        "href",
        "https://example.com/chapter",
      );
      expect(excerpt?.querySelectorAll(".rt-novel-excerpt__content p")).toHaveLength(2);
      expect(excerpt?.querySelector("footer a")).toBeNull();
      expect(editor.getJSON().content?.[0]?.attrs?.variant).toBe("forum-evidence");
      expect(editor.getHTML()).toContain('data-variant="fanqie"');
    } finally {
      view.unmount();
      editor.destroy();
    }
  });

  it("falls back for unknown presets and strips unsafe sources", () => {
    const content = document("unknown");
    content.content![0]!.attrs!.sourceUrl = "javascript:alert(1)";
    expect(sanitizeDocument(content).content?.[0]?.attrs).toMatchObject({
      variant: "fanqie",
      sourceUrl: null,
    });
  });

  it.each(variants)("%s 显示来源链接并保留可选择的正文", async (variant) => {
    const { container } = render(<RichTextViewer content={document(variant!)} />);
    expect(await screen.findByText("《Book <script>》")).toBeVisible();
    expect(container.querySelector(".rt-reader-attribution")).toBeNull();
    expect(screen.getByText("Chapter 2")).toBeVisible();
    expect(container.querySelectorAll(".rt-novel-excerpt__content p")).toHaveLength(2);
    expect(container.querySelector(".rt-reader-book-title a")).toHaveAttribute(
      "href",
      "https://example.com/chapter",
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector(".rt-novel-excerpt")).toHaveAttribute(
      "data-empty-bubble",
      variant === "fanqie" ? "false" : "true",
    );
    expect(container.querySelectorAll(".rt-inline-comment-anchor")).toHaveLength(0);
    expect(container.querySelector(".rt-reader-bottomline")).toHaveTextContent("1/1");
    expect(container.querySelectorAll(".rt-reader-status, .rt-reader-notifications")).toHaveLength(
      0,
    );
    if (variant === "sfacg") {
      expect(container.querySelector(".rt-reader-page > .rt-reader-book-title")).toBeNull();
      expect(
        container.querySelector(".rt-reader-bottomline .rt-reader-book-title"),
      ).toHaveTextContent("Book <script>");
      expect(container.querySelector(".rt-reader-topline .rt-reader-moon")).toHaveAttribute(
        "aria-hidden",
        "true",
      );
    } else {
      expect(container.querySelector(".rt-reader-page > .rt-reader-book-title")).toHaveTextContent(
        "Book <script>",
      );
      expect(container.querySelector(".rt-reader-page")?.firstElementChild).toHaveClass(
        "rt-reader-book-title",
      );
    }
    if (variant === "sfacg" || variant === "ciweimao") {
      expect(container.querySelector(".rt-reader-header-label")).toBeNull();
      expect(
        container.querySelector(".rt-reader-bottomline .rt-reader-percentage"),
      ).toHaveTextContent(variant === "ciweimao" ? "100.00%" : "100%");
    }
    expect(container.querySelectorAll(".rt-reader-battery")).toHaveLength(1);
    expect(container.querySelector(".rt-reader-bottomline .rt-reader-clock")).toHaveTextContent("");
    expect(container.querySelectorAll(".rt-reader-page > header strong")).toHaveLength(0);
  });

  it.each(variants)("%s 的阅读信息通过 HTML 保存往返且不会生成论坛评论数据", (variant) => {
    const content = document(variant);
    Object.assign(content.content![0]!.attrs!, {
      readerTime: "10:18",
      batteryLevel: 75,
      pageLabel: "2/20",
      progressLabel: "1.0%",
      headerLabel: "起点热评",
    });
    const editor = new Editor({ extensions: editorExtensions(), content });
    const html = editor.getHTML();
    expect(html).toContain('data-battery-level="75"');
    expect(html).toContain('aria-label="电量 75%"');
    expect(html).toContain("1.0%");
    const restored = new Editor({ extensions: editorExtensions(), content: html });
    expect(restored.getJSON()).toEqual(editor.getJSON());
    expect(restored.state.doc.textContent).toBe("First paragraphSecond paragraph");
    expect(html).not.toContain("inline-comment-anchor");
    restored.destroy();
    editor.destroy();
  });

  it.each(variants)("插入 %s 摘录时记录本地创建时间，重载后保持不变", (variant) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 7, 9, 6));
    const editor = new Editor({ extensions: editorExtensions(), content: "<p></p>" });
    try {
      editor.commands.insertNovelExcerpt({
        bookTitle: "Book",
        chapterTitle: "Chapter",
        author: "",
        sourceUrl: null,
        variant: variant as NovelExcerptAttributes["variant"],
      });
      expect(editor.getJSON().content?.[0]?.attrs?.readerTime).toBe("09:06");
      vi.setSystemTime(new Date(2026, 8, 8, 19, 40));
      const restored = new Editor({ extensions: editorExtensions(), content: editor.getJSON() });
      expect(restored.getJSON().content?.[0]?.attrs?.readerTime).toBe("09:06");
      restored.destroy();
    } finally {
      editor.destroy();
      vi.useRealTimers();
    }
  });

  it.each([null, "javascript:alert(1)"])(
    "renders an unlinked bracketed title for source %s",
    async (sourceUrl) => {
      const content = document("fanqie");
      Object.assign(content.content![0]!.attrs!, { sourceUrl, bookTitle: "《Already bracketed》" });
      const { container } = render(<RichTextViewer content={content} />);
      expect(await screen.findByText("《Already bracketed》")).toBeVisible();
      expect(container.querySelector(".rt-reader-book-title a")).toBeNull();
    },
  );

  it("leaves ordinary blockquotes ordinary", () => {
    const editor = new Editor({
      extensions: editorExtensions(),
      content: "<blockquote><p>Quote</p></blockquote>",
    });
    expect(editor.getJSON().content?.[0]?.type).toBe("blockquote");
    expect(editor.getHTML()).not.toContain("novel-excerpt");
    editor.destroy();
  });
});
