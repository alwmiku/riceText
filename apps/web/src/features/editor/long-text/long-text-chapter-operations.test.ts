import { describe, expect, it } from "vitest";
import type { RichTextNode } from "../../../lib/types";
import {
  appendGapLongTextChapter,
  appendLongTextChapter,
  deleteLongTextChapter,
  mergeLongTextChapter,
  moveLongTextChapter,
  splitLongTextChapter,
  updateLongTextChapter,
} from "./long-text-chapter-operations";

function documentFixture(): RichTextNode {
  return {
    type: "doc",
    content: [
      {
        type: "longTextBlock",
        attrs: {
          chapterId: "one",
          title: "第一章",
          text: "潮声",
          order: 0,
          start: 0,
          end: 2,
        },
      },
      {
        type: "longTextBlock",
        attrs: {
          chapterId: "two",
          title: "第二章",
          text: "灯塔",
          order: 1,
          start: 2,
          end: 4,
        },
      },
    ],
  };
}

describe("long text chapter operations", () => {
  it("deletes and moves chapters without mutating the source", () => {
    const source = documentFixture();
    const moved = moveLongTextChapter(source, 1, 0);
    expect(moved?.activeIndex).toBe(0);
    expect(moved?.document.content?.[0]?.attrs?.chapterId).toBe("two");
    expect(source.content?.[0]?.attrs?.chapterId).toBe("one");

    const deleted = deleteLongTextChapter(source, 0, 1);
    expect(deleted?.activeIndex).toBe(0);
    expect(deleted?.document.content).toHaveLength(1);
    expect(deleteLongTextChapter(source, 3, 0)).toBeNull();
  });

  it("merges adjacent chapters only within the configured length limit", () => {
    const result = mergeLongTextChapter(documentFixture(), 1);
    expect(result?.activeIndex).toBe(0);
    expect(result?.document.content).toHaveLength(1);
    expect(result?.document.content?.[0]?.attrs?.text).toBe("潮声\n\n灯塔");
    expect(mergeLongTextChapter(documentFixture(), 0)).toBeNull();
  });

  it("appends ordinary and raw-gap chapters with stable source ranges", () => {
    const appended = appendLongTextChapter(documentFixture(), {
      chapterId: "three",
      title: "第三章",
      text: "新章",
    });
    expect(appended.activeIndex).toBe(2);
    expect(appended.document.content?.[2]?.attrs).toMatchObject({
      chapterId: "three",
      order: 2,
      start: null,
      end: null,
    });

    const gap = appendGapLongTextChapter(documentFixture(), {
      chapterId: "gap",
      text: "空洞章节",
      start: 10,
      end: 18,
    });
    expect(gap?.document.content?.[2]?.attrs).toMatchObject({
      start: 10,
      end: 14,
    });
    expect(appendGapLongTextChapter(documentFixture(), {
      chapterId: "empty",
      text: " ",
      start: 0,
      end: 1,
    })).toBeNull();
  });

  it("splits and updates chapters by immutable chapter id", () => {
    const split = splitLongTextChapter(documentFixture(), 0, {
      chapterId: "new",
      before: "潮",
      after: "声",
    });
    expect(split?.activeIndex).toBe(1);
    expect(split?.document.content).toHaveLength(3);
    expect(split?.document.content?.[0]?.attrs?.text).toBe("潮");
    expect(split?.document.content?.[1]?.attrs).toMatchObject({
      chapterId: "new",
      text: "声",
      start: 1,
      end: 2,
    });

    const updated = updateLongTextChapter(documentFixture(), "two", {
      title: "改名",
      text: "新正文",
    });
    expect(updated?.content?.[1]?.attrs).toMatchObject({
      title: "改名",
      text: "新正文",
    });
    expect(updateLongTextChapter(documentFixture(), "missing", { title: "x" })).toBeNull();
  });
});
