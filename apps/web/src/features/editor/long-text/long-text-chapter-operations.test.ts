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
  it("deletes and moves chapters by stable id without mutating the source", () => {
    const source = documentFixture();
    const moved = moveLongTextChapter(source, "two", "one");
    expect(moved?.activeChapterId).toBe("two");
    expect(moved?.document.content?.[0]?.attrs?.chapterId).toBe("two");
    expect(source.content?.[0]?.attrs?.chapterId).toBe("one");

    const deleted = deleteLongTextChapter(source, "one", "one");
    expect(deleted?.activeChapterId).toBe("two");
    expect(deleted?.document.content).toHaveLength(1);
    expect(deleteLongTextChapter(source, "missing", "one")).toBeNull();
    // 删除后活动章节仍然存在时保持选中，不按位置猜测。
    const keepActive = deleteLongTextChapter(
      { ...source, content: [...source.content!, { type: "longTextBlock", attrs: { chapterId: "three" } }] },
      "one",
      "three",
    );
    expect(keepActive?.activeChapterId).toBe("three");
  });

  it("按「移到哪一章」支持跨多章的拖拽，而不是只移动一格", () => {
    const block = (id: string) => ({ type: "longTextBlock", attrs: { chapterId: id, text: id } });
    const source: RichTextNode = {
      type: "doc",
      content: [block("a"), block("b"), block("c"), block("d")],
    };
    // 拖到最后一章：命中目标索引，语义与旧的位置版一致。
    const toEnd = moveLongTextChapter(source, "a", "d");
    expect(toEnd?.document.content?.map((node) => node.attrs?.chapterId)).toEqual([
      "b",
      "c",
      "d",
      "a",
    ]);
    // 拖回最前。
    const toFront = moveLongTextChapter(source, "d", "a");
    expect(toFront?.document.content?.map((node) => node.attrs?.chapterId)).toEqual([
      "d",
      "a",
      "b",
      "c",
    ]);
    expect(moveLongTextChapter(source, "a", "a")).toBeNull();
    expect(moveLongTextChapter(source, "a", "missing")).toBeNull();
  });

  it("merges adjacent chapters only within the configured length limit", () => {
    const result = mergeLongTextChapter(documentFixture(), "two");
    expect(result?.activeChapterId).toBe("one");
    expect(result?.document.content).toHaveLength(1);
    expect(result?.document.content?.[0]?.attrs?.text).toBe("潮声\n\n灯塔");
    expect(mergeLongTextChapter(documentFixture(), "one")).toBeNull();
    expect(mergeLongTextChapter(documentFixture(), "missing")).toBeNull();
  });

  it("appends ordinary and raw-gap chapters with stable source ranges", () => {
    const appended = appendLongTextChapter(documentFixture(), {
      chapterId: "three",
      title: "第三章",
      text: "新章",
    });
    expect(appended.activeChapterId).toBe("three");
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
    const split = splitLongTextChapter(documentFixture(), "one", {
      chapterId: "new",
      before: "潮",
      after: "声",
    });
    expect(split?.activeChapterId).toBe("new");
    expect(split?.document.content).toHaveLength(3);
    expect(split?.document.content?.[0]?.attrs?.text).toBe("潮");
    expect(split?.document.content?.[1]?.attrs).toMatchObject({
      chapterId: "new",
      text: "声",
      start: 1,
      end: 2,
    });

    expect(splitLongTextChapter(documentFixture(), "missing", {
      chapterId: "new",
      before: "潮",
      after: "声",
    })).toBeNull();

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
