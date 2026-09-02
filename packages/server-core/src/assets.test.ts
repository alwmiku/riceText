// 共享核心必须在 Node 与 Worker 中表现一致，这里集中覆盖文件边界和隐藏章节投影。
import { describe, expect, it } from "vitest";
import {
  detectImageMime,
  extensionForImage,
  projectDocumentForReader,
  repairDocumentForRead,
  sanitizeOriginalName,
  sha256Hex,
} from "./index";

describe("server asset rules", () => {
  it("detects every supported image signature and rejects invalid bytes", () => {
    expect(detectImageMime(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe("image/png");
    expect(detectImageMime(new Uint8Array([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(detectImageMime(new TextEncoder().encode("GIF87a"))).toBe("image/gif");
    expect(detectImageMime(new TextEncoder().encode("GIF89a"))).toBe("image/gif");
    expect(detectImageMime(new TextEncoder().encode("RIFF1234WEBP"))).toBe("image/webp");
    expect(detectImageMime(new Uint8Array())).toBeNull();
    expect(detectImageMime(new TextEncoder().encode("not-an-image"))).toBeNull();
  });

  it("maps extensions, sanitizes names, and hashes bytes", async () => {
    expect(extensionForImage("image/png")).toBe("png");
    expect(extensionForImage("image/jpeg")).toBe("jpg");
    expect(extensionForImage("image/gif")).toBe("gif");
    expect(extensionForImage("image/webp")).toBe("webp");
    expect(sanitizeOriginalName(String.raw`C:\fakepath\photo.png`, "fallback.png")).toBe("photo.png");
    expect(sanitizeOriginalName("\u0000", "fallback.png")).toBe("_");
    expect(sanitizeOriginalName("", "fallback.png")).toBe("fallback.png");
    expect(sanitizeOriginalName("x".repeat(300), "fallback.png")).toHaveLength(255);
    expect(await sha256Hex(new TextEncoder().encode("rice"))).toBe(
      "209f76418ece7c936b65ff4777a578d860f762c37ad6c7f08f5826242199ef51",
    );
  });
});

describe("reader document projection", () => {
  const document = {
    type: "doc" as const,
    content: [
      { type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: "作品" }] },
      { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "公开章" }] },
      { type: "paragraph", content: [{ type: "text", text: "公开正文" }] },
      { type: "heading", attrs: { level: 2, chapterStart: true }, content: [{ type: "text", text: "隐藏章" }] },
      { type: "paragraph", content: [{ type: "text", text: "隐藏正文" }] },
    ],
  };

  it("returns the repaired document unchanged without hidden orders", () => {
    expect(projectDocumentForReader(document, new Set())).toEqual(
      repairDocumentForRead(document),
    );
  });

  it("removes complete hidden chapter ranges while preserving lead and public chapters", () => {
    const projected = projectDocumentForReader(document, new Set([1]));
    expect(JSON.stringify(projected)).toContain("公开正文");
    expect(JSON.stringify(projected)).toContain("作品");
    expect(JSON.stringify(projected)).not.toContain("隐藏正文");
    expect(JSON.stringify(projected)).not.toContain("隐藏章");
  });
});
