import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file: string) => readFile(path.join(root, file), "utf8");

describe("章节编辑单元架构边界", () => {
  it("创作会话不反向依赖编辑器 UI hook", async () => {
    const source = await read("apps/web/src/features/compose/useComposeDocument.ts");
    expect(source).not.toMatch(/features\/editor|..\/editor/u);
    expect(source).toContain('from "./useAutosave"');
  });

  it("业务面板通过工具注册表扩展而不是硬编码具体工具", async () => {
    const source = await read("apps/web/src/features/forum/ForumBusinessPanel.tsx");
    expect(source).toContain("DEFAULT_CHAPTER_TOOLS");
    expect(source).not.toMatch(/SuggestionPanel|AttachmentPanel|PollPanel|HistoryPanel/u);
  });

  it("卷层级只由 document-core 投影，目录组件不自行清理 volumeTitle", async () => {
    for (const file of [
      "apps/web/src/features/viewer/TocSidebar.tsx",
      "apps/web/src/features/forum/ChapterRail.tsx",
      "apps/web/src/features/novel/ChapterSidebar.tsx",
    ]) {
      const source = await read(file);
      expect(source).not.toMatch(/volumeTitle\?\.trim/u);
    }
  });

  it("目录不同步时禁止回退到第一条服务器章节", async () => {
    const source = await read("apps/web/src/features/compose/useComposeDocument.ts");
    expect(source).not.toMatch(/cachedDirectory\[0\]/u);
    expect(source).toContain("resolveChapterDirectoryIdentity");
  });
});
