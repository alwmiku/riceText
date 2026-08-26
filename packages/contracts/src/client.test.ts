import { describe, expect, it, vi } from "vitest";
import { ApiClientError, createApiClient } from "./client.js";

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });

describe("createApiClient", () => {
  it("为全部公开方法生成正确请求，并区分 JSON 与 multipart 请求头", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true }));
    const client = createApiClient({
      baseUrl: "https://forum.example.test/",
      userId: "author",
      fetch: fetchMock as unknown as typeof fetch,
    });
    const controller = new AbortController();
    const content = { type: "doc" as const, content: [{ type: "paragraph" }] };

    await client.getDocument("forum post", controller.signal);
    await client.updateDocument("demo-post", {
      schemaVersion: 1,
      baseRevision: 2,
      clientMutationId: "save-1",
      content,
    });
    await client.listRevisions("demo-post", "3");
    await client.rollbackDocument("demo-post", {
      baseRevision: 3,
      targetRevision: 1,
      clientMutationId: "rollback-1",
    });
    await client.uploadAsset(
      new File([new Uint8Array([1, 2, 3])], "cover.png", { type: "image/png" }),
    );
    await client.createDice("3d5");
    await client.getDice("roll-1");
    await client.rerollDice("roll-1");
    await client.getCommentThread("demo-post", "anchor-opening");
    await client.getCommentThread(
      "demo-post",
      "anchor-opening",
      "newest",
      "root-1",
    );
    await client.createCommentReply("demo-post", "anchor-opening", "根回复");
    await client.createCommentReply(
      "demo-post",
      "anchor-opening",
      "子回复",
      "root-1",
    );
    await client.voteComment("reply-1", -1);
    await client.getForumSession();
    await client.searchUsers("林");
    await client.searchUsers("远舟", true);
    await client.resolveMention("远舟");
    await client.resolveMention("林见", "author");
    await client.resolveReplyGate("gate-bonus", "demo-post");
    await client.listSuggestions("demo-post");
    await client.createSuggestion("demo-post", {
      fromText: "雾线",
      toText: "雾气",
      reason: "用词更准确",
      chapterId: "chapter-1",
      chapterTitle: "第一章 · 潮汐表",
      lineNo: 3,
      lineText: "雾线越过长街。",
    });
    await client.getAttachment("attachment-sample");
    await client.purchaseAttachment("attachment-sample");
    await client.getPoll("poll-route");
    await client.submitPollVote("poll-route", ["poll-option-tower"]);
    await client.listPollVotes("poll-route");
    await client.listPollVotes("poll-route", "vote-1");

    const calls = fetchMock.mock.calls as unknown as Array<
      [string, RequestInit]
    >;
    expect(calls).toHaveLength(27);
    expect(calls[0]?.[0]).toBe(
      "https://forum.example.test/api/documents/forum post",
    );
    expect(calls[0]?.[1].signal).toBe(controller.signal);
    expect(calls[2]?.[0]).toBe(
      "https://forum.example.test/api/documents/demo-post/revisions?cursor=3",
    );
    expect(calls[8]?.[0]).toBe(
      "https://forum.example.test/api/documents/demo-post/comments/anchor-opening?sort=score",
    );
    expect(calls[9]?.[0]).toBe(
      "https://forum.example.test/api/documents/demo-post/comments/anchor-opening?sort=newest&cursor=root-1",
    );
    expect(calls[14]?.[0]).toBe(
      "https://forum.example.test/api/forum/users/search?q=%E6%9E%97&friendsOnly=false",
    );
    expect(calls[26]?.[0]).toBe(
      "https://forum.example.test/api/forum/polls/poll-route/votes?cursor=vote-1",
    );

    const updateInit = calls[1]![1];
    expect(updateInit.method).toBe("PUT");
    expect(JSON.parse(String(updateInit.body))).toMatchObject({
      baseRevision: 2,
      clientMutationId: "save-1",
    });
    expect(new Headers(updateInit.headers)).toEqual(
      expect.objectContaining({}),
    );
    expect(new Headers(updateInit.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(new Headers(updateInit.headers).get("x-user-id")).toBe("author");

    const uploadInit = calls[4]![1];
    expect(uploadInit.method).toBe("POST");
    expect(uploadInit.body).toBeInstanceOf(FormData);
    expect((uploadInit.body as FormData).get("file")).toBeInstanceOf(File);
    expect(new Headers(uploadInit.headers).get("content-type")).toBeNull();
    expect(new Headers(uploadInit.headers).get("x-user-id")).toBe("author");
    expect(JSON.parse(String(calls[10]![1].body))).toEqual({
      body: "根回复",
      parentId: null,
    });
    expect(JSON.parse(String(calls[11]![1].body))).toEqual({
      body: "子回复",
      parentId: "root-1",
    });
    expect(JSON.parse(String(calls[16]![1].body))).toEqual({ name: "远舟" });
    expect(JSON.parse(String(calls[17]![1].body))).toEqual({
      name: "林见",
      userId: "author",
    });
    expect(calls[20]?.[0]).toBe(
      "https://forum.example.test/api/forum/documents/demo-post/suggestions",
    );
    expect(calls[20]?.[1].method).toBe("POST");
    expect(JSON.parse(String(calls[20]?.[1].body))).toMatchObject({
      fromText: "雾线",
      toText: "雾气",
      chapterId: "chapter-1",
      lineNo: 3,
    });
  });

  it("把结构化失败响应转换为 ApiClientError", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "REVISION_CONFLICT",
            message: "文档已经更新",
            details: { currentRevision: 4 },
          },
        },
        { status: 409 },
      ),
    );
    const client = createApiClient({
      fetch: fetchMock as unknown as typeof fetch,
    });

    const error = await client
      .getDocument("demo-post")
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ApiClientError);
    expect(error).toMatchObject({
      name: "ApiClientError",
      status: 409,
      code: "REVISION_CONFLICT",
      message: "文档已经更新",
      details: { currentRevision: 4 },
    });
  });

  it("在失败响应不是 JSON 时使用 HTTP 默认错误信息", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response("not-json", { status: 502, statusText: "Bad Gateway" }),
    );
    const client = createApiClient({
      fetch: fetchMock as unknown as typeof fetch,
    });

    await expect(client.getDocument("demo-post")).rejects.toMatchObject({
      status: 502,
      code: "HTTP_ERROR",
      message: "Bad Gateway",
      details: undefined,
    });
  });
});
