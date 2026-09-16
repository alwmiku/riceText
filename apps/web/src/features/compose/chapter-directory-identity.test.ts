import { describe, expect, it } from "vitest";
import type { ForumChapterItem } from "../../lib/types";
import { resolveChapterDirectoryIdentity } from "./chapter-directory-identity";

const row = (id: string, order: number): ForumChapterItem => ({
  id,
  documentId: "article_1",
  title: id,
  order,
  revision: 1,
  hidden: false,
  savedAt: "2026-09-16T00:00:00.000Z",
});

describe("章节目录身份解析", () => {
  it("稳定 ID 优先于位置", () => {
    expect(resolveChapterDirectoryIdentity([row("chapter_a", 9)], 0, "chapter_a")).toBe(
      "chapter_a",
    );
  });

  it("旧正文只接受唯一 order 对齐", () => {
    expect(resolveChapterDirectoryIdentity([row("chapter_a", 0)], 0, "legacy")).toBe("chapter_a");
    expect(
      resolveChapterDirectoryIdentity([row("chapter_a", 0), row("chapter_b", 0)], 0, "legacy"),
    ).toBeUndefined();
  });

  it("目录不同步时绝不回退第一行或未注册正文 ID", () => {
    expect(
      resolveChapterDirectoryIdentity([row("chapter_first", 0)], 1, "chapter_local"),
    ).toBeUndefined();
    expect(resolveChapterDirectoryIdentity([], 0, "chapter_local")).toBeUndefined();
  });
});
