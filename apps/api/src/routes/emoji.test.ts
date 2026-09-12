import { afterEach, describe, expect, it } from "vitest";
import { CUSTOM_EMOJI_ENTRIES, EMOJI_CATALOG } from "@ricetext/contracts";
import { closeTestApp, createTestApp, type TestAppHandle } from "../test-helpers.js";

describe("表情路由", () => {
  let handle: TestAppHandle;

  afterEach(async () => {
    if (handle) await closeTestApp(handle);
  });

  it("返回目录：分组与条目同源", async () => {
    handle = await createTestApp();
    const response = await handle.app.inject({ method: "GET", url: "/api/emoji" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["cache-control"]).toBe("public, max-age=3600");
    const body = response.json();
    expect(body.groups.map((group: { id: string }) => group.id)).toEqual([
      "faces",
      "gestures",
      "symbols",
      "kaomoji",
      "custom",
    ]);
    expect(body.items.length).toBe(EMOJI_CATALOG.length);
    expect(body.items.length).toBeGreaterThanOrEqual(120);
  });

  it("返回表情包里的动图并带 immutable 缓存头", async () => {
    handle = await createTestApp();
    const response = await handle.app.inject({ method: "GET", url: "/api/emoji/hug/image" });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/gif");
    expect(response.headers["cache-control"]).toBe("public, max-age=31536000, immutable");
    expect(response.rawPayload.subarray(0, 6).toString("ascii")).toMatch(/^GIF8[79]a$/u);
    // 动图必须是多帧的：至少出现两次图形控制扩展块。
    let frames = 0;
    for (let index = 0; index < response.rawPayload.length - 1; index += 1) {
      if (response.rawPayload[index] === 0x21 && response.rawPayload[index + 1] === 0xf9)
        frames += 1;
    }
    expect(frames).toBeGreaterThan(1);
  });

  it("目录里每个自定义表情都能读出 500×500 的图片资源", async () => {
    handle = await createTestApp();
    for (const entry of CUSTOM_EMOJI_ENTRIES) {
      const response = await handle.app.inject({
        method: "GET",
        url: `/api/emoji/${entry.id}/image`,
      });
      expect(response.statusCode, entry.id).toBe(200);
      expect(entry.assetFile, entry.id).toBeTruthy();
      // GIF 的逻辑屏幕宽高是小端序写在偏移 6 与 8 处。
      expect(response.rawPayload.readUInt16LE(6), entry.id).toBe(500);
      expect(response.rawPayload.readUInt16LE(8), entry.id).toBe(500);
    }
  });

  it("?frame=first 返回构建期生成的首帧缩略图，避免面板解码动图", async () => {
    handle = await createTestApp();
    const response = await handle.app.inject({
      method: "GET",
      url: "/api/emoji/hug/image?frame=first",
    });
    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
    // 索引色 PNG：IHDR 里宽高都是 48。
    expect(response.rawPayload.readUInt32BE(16)).toBe(48);
    expect(response.rawPayload.readUInt32BE(20)).toBe(48);
    expect(response.rawPayload.length).toBeLessThan(4 * 1024);
  });

  it("纯文本表情即便带 frame=first 也返回 404", async () => {
    handle = await createTestApp();
    const response = await handle.app.inject({
      method: "GET",
      url: "/api/emoji/smile/image?frame=first",
    });
    expect(response.statusCode).toBe(404);
    expect(response.json().error.code).toBe("EMOJI_NOT_FOUND");
  });

  it("表情连字号一起保存后能读回：mark 不被净化器丢弃", async () => {
    handle = await createTestApp();
    // 字号是表情显示大小的唯一来源，落在 textStyle mark 上；
    // 若净化器把 emoji 上的 mark 剥掉，"放大表情"保存后就会失效。
    const content = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          attrs: { textAlign: "left" },
          content: [
            {
              type: "text",
              text: "前文",
              marks: [{ type: "textStyle", attrs: { fontSize: "400px" } }],
            },
            {
              type: "emoji",
              attrs: {
                emojiId: "hug",
                name: "抱抱",
                src: "/api/emoji/hug/image",
                fallback: "🤗",
              },
              marks: [{ type: "textStyle", attrs: { fontSize: "400px" } }],
            },
          ],
        },
      ],
    };
    const saved = await handle.app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
      payload: {
        schemaVersion: 1,
        baseRevision: 1,
        clientMutationId: "emoji-with-size",
        content,
      },
    });
    expect(saved.statusCode, saved.body).toBe(201);

    const loaded = await handle.app.inject({ method: "GET", url: "/api/documents/demo-post" });
    expect(loaded.statusCode).toBe(200);
    const emoji = (
      loaded.json().content as {
        content: Array<{ content?: Array<{ type: string; marks?: unknown }> }>;
      }
    ).content[0]?.content?.[1];
    expect(emoji?.type).toBe("emoji");
    expect(emoji?.marks).toEqual([{ type: "textStyle", attrs: { fontSize: "400px" } }]);
  });

  it("未知 id 与纯文本表情返回 404，非法 id 被请求校验挡在路由之前", async () => {
    handle = await createTestApp();
    for (const url of ["/api/emoji/no-such-emoji/image", "/api/emoji/smile/image"]) {
      const response = await handle.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(404);
      expect(response.json().error.code).toBe("EMOJI_NOT_FOUND");
    }
    // 目录 id 的正则同时是路径穿越防线：非法 id 在 Ajv 参数校验阶段就被拒绝，
    // 永远走不到文件读取。
    for (const url of [
      "/api/emoji/%2e%2e%2f%2e%2e%2fpackage/image",
      "/api/emoji/hug..%2f..%2fsecret/image",
    ]) {
      const response = await handle.app.inject({ method: "GET", url });
      expect(response.statusCode).toBe(422);
      expect(response.json().error.code).toBe("VALIDATION_ERROR");
    }
  });
});
