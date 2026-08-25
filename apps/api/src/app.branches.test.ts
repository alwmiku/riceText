import { DatabaseSync } from "node:sqlite";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const MEBIBYTE = 1024 * 1024;

const contentWithAnchor = (text = "更新后的正文") => ({
  type: "doc" as const,
  content: [
    {
      type: "paragraph",
      content: [
        { type: "text", text },
        {
          type: "inlineCommentAnchor",
          attrs: { threadId: "anchor-opening", count: 2, placement: "end" },
        },
      ],
    },
  ],
});

const contentWithoutAnchor = {
  type: "doc" as const,
  content: [
    { type: "paragraph", content: [{ type: "text", text: "锚点已经删除" }] },
  ],
};

function multipartFile(
  bytes: Buffer,
  mimeType: string,
  fileName = "upload.png",
) {
  const boundary = `----RiceText-${Math.random().toString(16).slice(2)}`;
  const prefix = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${fileName}"\r\nContent-Type: ${mimeType}\r\n\r\n`,
  );
  const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat([prefix, bytes, suffix]),
  };
}

function multipartTextField() {
  const boundary = "----RiceText-NoFile";
  return {
    headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\n没有文件\r\n--${boundary}--\r\n`,
    ),
  };
}

describe("RiceText API 补充分支", () => {
  let directory: string;
  let databasePath: string;
  let uploadsDirectory: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ricetext-api-branches-"));
    databasePath = join(directory, "test.sqlite");
    uploadsDirectory = join(directory, "uploads");
    app = await createApp({ databasePath, uploadsDirectory, logger: false });
  });

  afterEach(async () => {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  const editDatabase = (edit: (database: DatabaseSync) => void): void => {
    const database = new DatabaseSync(databasePath);
    try {
      edit(database);
    } finally {
      database.close();
    }
  };

  it("返回健康状态、404、字段 422、权限 403，并覆盖保存与回滚幂等错误", async () => {
    const health = await app.inject({ method: "GET", url: "/health" });
    expect(health.statusCode).toBe(200);
    expect(health.json()).toEqual({ ok: true });

    const missingRoute = await app.inject({
      method: "GET",
      url: "/api/not-a-route",
    });
    expect(missingRoute.statusCode).toBe(404);
    expect(missingRoute.json().error.code).toBe("ROUTE_NOT_FOUND");

    const missingDocument = await app.inject({
      method: "GET",
      url: "/api/documents/not-found",
    });
    expect(missingDocument.statusCode).toBe(404);
    expect(missingDocument.json().error.code).toBe("DOCUMENT_NOT_FOUND");

    const invalidBody = await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
      payload: {},
    });
    expect(invalidBody.statusCode).toBe(422);
    expect(invalidBody.json().error.code).toBe("VALIDATION_ERROR");

    const forbiddenFallback = await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "unknown-user" },
      payload: {
        schemaVersion: 1,
        baseRevision: 1,
        clientMutationId: "forbidden",
        content: contentWithAnchor(),
      },
    });
    expect(forbiddenFallback.statusCode).toBe(403);
    expect(forbiddenFallback.json().error.code).toBe("FORBIDDEN");

    const firstRequest = {
      schemaVersion: 1,
      baseRevision: 1,
      clientMutationId: "same-mutation",
      content: contentWithAnchor("第一次保存"),
    };
    const saved = await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
      payload: firstRequest,
    });
    expect(saved.statusCode).toBe(201);

    const reused = await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
      payload: {
        ...firstRequest,
        baseRevision: 2,
        content: contentWithAnchor("另一份内容"),
      },
    });
    expect(reused.statusCode).toBe(409);
    expect(reused.json().error.code).toBe("MUTATION_ID_REUSED");

    const rollbackRequest = {
      baseRevision: 2,
      targetRevision: 1,
      clientMutationId: "rollback-idempotent",
    };
    const rollback = await app.inject({
      method: "POST",
      url: "/api/documents/demo-post/rollback",
      headers: { "x-user-id": "moderator" },
      payload: rollbackRequest,
    });
    expect(rollback.statusCode).toBe(201);
    const rollbackRetry = await app.inject({
      method: "POST",
      url: "/api/documents/demo-post/rollback",
      headers: { "x-user-id": "moderator" },
      payload: rollbackRequest,
    });
    expect(rollbackRetry.statusCode).toBe(200);
    expect(rollbackRetry.json().revision).toBe(rollback.json().revision);

    const invalidCursor = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post/revisions?cursor=not-a-revision",
    });
    expect(invalidCursor.statusCode).toBe(422);
    expect(invalidCursor.json().error.code).toBe("INVALID_CURSOR");
  });

  it("拒绝缺失、MIME 不符和过大的上传，并带缓存头读取已上传图片", async () => {
    const missing = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartTextField(),
    });
    expect(missing.statusCode).toBe(422);
    expect(missing.json().error.code).toBe("ASSET_FILE_REQUIRED");

    const pngSignature = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
    const mismatch = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartFile(pngSignature, "image/jpeg"),
    });
    expect(mismatch.statusCode).toBe(415);
    expect(mismatch.json().error.code).toBe("UNSUPPORTED_IMAGE");

    const unsupported = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartFile(Buffer.from("not an image"), "image/png"),
    });
    expect(unsupported.statusCode).toBe(415);

    const supportedImages = [
      {
        bytes: Buffer.from([0xff, 0xd8, 0xff]),
        mimeType: "image/jpeg",
        fileName: "photo.jpg",
      },
      {
        bytes: Buffer.from("GIF89a", "ascii"),
        mimeType: "image/gif",
        fileName: "motion.gif",
      },
      {
        bytes: Buffer.from("RIFF0000WEBP", "ascii"),
        mimeType: "image/webp",
        fileName: "modern.webp",
      },
    ];
    for (const sample of supportedImages) {
      const response = await app.inject({
        method: "POST",
        url: "/api/assets",
        ...multipartFile(sample.bytes, sample.mimeType, sample.fileName),
      });
      expect(response.statusCode, response.body).toBe(201);
      expect(response.json()).toMatchObject({
        mimeType: sample.mimeType,
        fileName: sample.fileName,
      });
    }

    const oversizedBytes = Buffer.concat([
      pngSignature,
      Buffer.alloc(8 * MEBIBYTE),
    ]);
    const oversized = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartFile(oversizedBytes, "image/png", "large.png"),
    });
    expect(oversized.statusCode).toBe(413);
    expect(oversized.json().error.code).toBe("ASSET_TOO_LARGE");

    const uploaded = await app.inject({
      method: "POST",
      url: "/api/assets",
      ...multipartFile(pngSignature, "image/png", "tiny.png"),
    });
    expect(uploaded.statusCode).toBe(201);
    const loaded = await app.inject({
      method: "GET",
      url: uploaded.json().url as string,
    });
    expect(loaded.rawPayload).toEqual(pngSignature);
    expect(loaded.headers["content-type"]).toContain("image/png");
    expect(loaded.headers["cache-control"]).toBe(
      "public, max-age=31536000, immutable",
    );
    expect(loaded.headers["content-disposition"]).toContain("tiny.png");

    const missingAsset = await app.inject({
      method: "GET",
      url: "/api/assets/no-such-asset",
    });
    expect(missingAsset.statusCode).toBe(404);
    expect(missingAsset.json().error.code).toBe("ASSET_NOT_FOUND");
  });

  it("验证骰子表达式、稳定读取、rerollOf 入口与不存在的重投链", async () => {
    const invalid = await app.inject({
      method: "POST",
      url: "/api/dice",
      payload: { expression: "not dice" },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe("INVALID_DICE_EXPRESSION");

    const missing = await app.inject({
      method: "GET",
      url: "/api/dice/no-such-roll",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("DICE_ROLL_NOT_FOUND");

    const missingReroll = await app.inject({
      method: "POST",
      url: "/api/dice/no-such-roll/reroll",
    });
    expect(missingReroll.statusCode).toBe(404);

    const first = await app.inject({
      method: "POST",
      url: "/api/dice",
      payload: { expression: "2d6" },
    });
    const rerolled = await app.inject({
      method: "POST",
      url: "/api/dice",
      payload: { expression: "2d6", rerollOf: first.json().rollId },
    });
    expect(rerolled.statusCode).toBe(201);
    expect(rerolled.json()).toMatchObject({
      rootRollId: first.json().rootRollId,
      rerollOf: first.json().rollId,
      expression: "2d6",
    });
    const loaded = await app.inject({
      method: "GET",
      url: `/api/dice/${rerolled.json().rollId as string}`,
    });
    expect(loaded.json()).toEqual(rerolled.json());
  });

  it("分页读取根回复、创建楼中楼、撤销投票并在删除锚点后只读归档", async () => {
    const root = await app.inject({
      method: "POST",
      url: "/api/documents/demo-post/comments/anchor-opening/replies",
      headers: { "x-user-id": "wanderer" },
      payload: { parentId: null, body: "第二个根回复" },
    });
    const child = await app.inject({
      method: "POST",
      url: "/api/documents/demo-post/comments/anchor-opening/replies",
      headers: { "x-user-id": "author" },
      payload: { parentId: root.json().id, body: "新楼中楼" },
    });
    expect(child.statusCode).toBe(201);
    expect(child.json().parentId).toBe(root.json().id);

    const firstPage = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post/comments/anchor-opening?sort=score&limit=1",
    });
    expect(firstPage.statusCode).toBe(200);
    expect(firstPage.json().items).toHaveLength(1);
    expect(firstPage.json().pageInfo.nextCursor).toBe("comment-root");
    const secondPage = await app.inject({
      method: "GET",
      url: `/api/documents/demo-post/comments/anchor-opening?sort=score&limit=1&cursor=${firstPage.json().pageInfo.nextCursor as string}`,
    });
    expect(secondPage.json().items[0].id).toBe(root.json().id);
    expect(secondPage.json().items[0].children[0].id).toBe(child.json().id);

    const badCursor = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post/comments/anchor-opening?cursor=missing-root",
    });
    expect(badCursor.statusCode).toBe(422);
    expect(badCursor.json().error.code).toBe("INVALID_CURSOR");
    const badParent = await app.inject({
      method: "POST",
      url: "/api/documents/demo-post/comments/anchor-opening/replies",
      payload: { parentId: "missing-parent", body: "找不到父回复" },
    });
    expect(badParent.statusCode).toBe(404);
    expect(badParent.json().error.code).toBe("PARENT_REPLY_NOT_FOUND");

    const downvote = await app.inject({
      method: "PUT",
      url: `/api/comments/replies/${root.json().id as string}/vote`,
      payload: { value: -1 },
    });
    expect(downvote.json()).toMatchObject({
      score: -1,
      downvotes: 1,
      myVote: -1,
    });
    const unvote = await app.inject({
      method: "PUT",
      url: `/api/comments/replies/${root.json().id as string}/vote`,
      payload: { value: 0 },
    });
    expect(unvote.json()).toMatchObject({
      score: 0,
      upvotes: 0,
      downvotes: 0,
      myVote: 0,
    });
    const missingVote = await app.inject({
      method: "PUT",
      url: "/api/comments/replies/missing-reply/vote",
      payload: { value: 1 },
    });
    expect(missingVote.statusCode).toBe(404);

    const emptyThread = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post/comments/new-anchor",
    });
    expect(emptyThread.json()).toMatchObject({
      archived: false,
      total: 0,
      items: [],
    });
    const missingAnchorReply = await app.inject({
      method: "POST",
      url: "/api/documents/demo-post/comments/new-anchor/replies",
      payload: { parentId: null, body: "不存在的锚点" },
    });
    expect(missingAnchorReply.statusCode).toBe(404);

    const archived = await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
      payload: {
        schemaVersion: 1,
        baseRevision: 1,
        clientMutationId: "remove-anchor",
        content: contentWithoutAnchor,
      },
    });
    expect(archived.statusCode).toBe(201);
    const archivedThread = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post/comments/anchor-opening",
    });
    expect(archivedThread.json()).toMatchObject({ archived: true, total: 4 });
    const rejectedReply = await app.inject({
      method: "POST",
      url: "/api/documents/demo-post/comments/anchor-opening/replies",
      payload: { parentId: null, body: "归档后回复" },
    });
    expect(rejectedReply.statusCode).toBe(409);
    expect(rejectedReply.json().error.code).toBe("COMMENT_THREAD_ARCHIVED");
  });

  it("覆盖论坛会话、好友搜索、未解析 @、章节、回复可见错误与建议拒绝", async () => {
    const session = await app.inject({
      method: "GET",
      url: "/api/forum/session",
      headers: { "x-user-id": "not-seeded" },
    });
    expect(session.json().current.id).toBe("reader");
    expect(
      session.json().available.map((user: { id: string }) => user.id),
    ).toEqual(["author", "reader", "wanderer", "moderator"]);

    const chapters = await app.inject({
      method: "GET",
      url: "/api/forum/chapters",
    });
    expect(
      chapters.json().items.map((chapter: { order: number }) => chapter.order),
    ).toEqual([0, 1, 2, 3, 4]);
    const friends = await app.inject({
      method: "GET",
      url: "/api/forum/users/search?q=&friendsOnly=true",
    });
    expect(friends.json().items.map((user: { id: string }) => user.id)).toEqual(
      expect.arrayContaining(["author", "reader"]),
    );
    expect(friends.json().items).toHaveLength(2);
    const byId = await app.inject({
      method: "GET",
      url: "/api/forum/users/search?q=WANDERER",
    });
    expect(byId.json().items[0].id).toBe("wanderer");

    const unresolved = await app.inject({
      method: "POST",
      url: "/api/forum/mentions/resolve",
      payload: { name: "不存在的人" },
    });
    expect(unresolved.json()).toEqual({
      resolved: false,
      displayText: "@不存在的人",
      user: null,
    });
    const resolvedById = await app.inject({
      method: "POST",
      url: "/api/forum/mentions/resolve",
      payload: { name: "旧名字", userId: "author" },
    });
    expect(resolvedById.json()).toMatchObject({
      resolved: true,
      displayText: "@林见",
      user: { id: "author" },
    });

    const missingGate = await app.inject({
      method: "POST",
      url: "/api/forum/reply-gates/resolve",
      payload: { gateId: "missing-gate", documentId: "demo-post" },
    });
    expect(missingGate.statusCode).toBe(404);
    expect(missingGate.json().error.code).toBe("REPLY_GATE_NOT_FOUND");

    const suggestion = await app.inject({
      method: "POST",
      url: "/api/forum/documents/demo-post/suggestions",
      headers: { "x-user-id": "reader" },
      payload: { fromText: "潮声", toText: "海潮声", reason: "建议替换" },
    });
    const ownerList = await app.inject({
      method: "GET",
      url: "/api/forum/documents/demo-post/suggestions",
      headers: { "x-user-id": "reader" },
    });
    // 种子建议：reader 拥有 suggestion-1/3/4，wanderer 拥有 suggestion-2/5
    expect(ownerList.json().items).toHaveLength(4);
    const otherReaderList = await app.inject({
      method: "GET",
      url: "/api/forum/documents/demo-post/suggestions",
      headers: { "x-user-id": "wanderer" },
    });
    expect(otherReaderList.json().items).toHaveLength(2);
    const authorList = await app.inject({
      method: "GET",
      url: "/api/forum/documents/demo-post/suggestions",
      headers: { "x-user-id": "author" },
    });
    expect(authorList.json().items).toHaveLength(6);

    const forbiddenReview = await app.inject({
      method: "PATCH",
      url: `/api/forum/suggestions/${suggestion.json().id as string}`,
      headers: { "x-user-id": "reader" },
      payload: { decision: "reject", baseRevision: 1 },
    });
    expect(forbiddenReview.statusCode).toBe(403);
    const rejected = await app.inject({
      method: "PATCH",
      url: `/api/forum/suggestions/${suggestion.json().id as string}`,
      headers: { "x-user-id": "author" },
      payload: { decision: "reject", baseRevision: 1 },
    });
    expect(rejected.json()).toMatchObject({
      suggestion: { status: "rejected", reviewerId: "author" },
      document: null,
    });
    const reviewedTwice = await app.inject({
      method: "PATCH",
      url: `/api/forum/suggestions/${suggestion.json().id as string}`,
      headers: { "x-user-id": "author" },
      payload: { decision: "reject", baseRevision: 1 },
    });
    expect(reviewedTwice.statusCode).toBe(409);
    expect(reviewedTwice.json().error.code).toBe("SUGGESTION_REVIEWED");
  });

  it("报告建议审核冲突与缺失原文", async () => {
    const conflictSuggestion = await app.inject({
      method: "POST",
      url: "/api/forum/documents/demo-post/suggestions",
      payload: { fromText: "潮声", toText: "海潮声", reason: "冲突测试" },
    });
    await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
      payload: {
        schemaVersion: 1,
        baseRevision: 1,
        clientMutationId: "advance-before-review",
        content: contentWithAnchor("正文变化"),
      },
    });
    const conflict = await app.inject({
      method: "PATCH",
      url: `/api/forum/suggestions/${conflictSuggestion.json().id as string}`,
      headers: { "x-user-id": "author" },
      payload: { decision: "approve", baseRevision: 1 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error).toMatchObject({
      code: "REVISION_CONFLICT",
      details: { currentRevision: 2, baseRevision: 1 },
    });

    const absentSuggestion = await app.inject({
      method: "POST",
      url: "/api/forum/documents/demo-post/suggestions",
      payload: { fromText: "完全不存在", toText: "替换值", reason: "缺失测试" },
    });
    const absent = await app.inject({
      method: "PATCH",
      url: `/api/forum/suggestions/${absentSuggestion.json().id as string}`,
      headers: { "x-user-id": "moderator" },
      payload: { decision: "approve", baseRevision: 2 },
    });
    expect(absent.statusCode).toBe(404);
    expect(absent.json().error.code).toBe("SUGGESTION_SOURCE_NOT_FOUND");

    const missing = await app.inject({
      method: "PATCH",
      url: "/api/forum/suggestions/no-suggestion",
      headers: { "x-user-id": "author" },
      payload: { decision: "reject", baseRevision: 2 },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("SUGGESTION_NOT_FOUND");
  });

  it("隐藏未购附件、保证重复购买幂等并拒绝余额不足", async () => {
    const locked = await app.inject({
      method: "GET",
      url: "/api/forum/attachments/attachment-sample",
      headers: { "x-user-id": "reader" },
    });
    expect(locked.json()).toMatchObject({
      purchased: false,
      downloadUrl: null,
      price: 10,
    });
    const authorView = await app.inject({
      method: "GET",
      url: "/api/forum/attachments/attachment-sample",
      headers: { "x-user-id": "author" },
    });
    expect(authorView.json()).toMatchObject({
      purchased: true,
      downloadUrl: "/forum-downloads/mist-harbor.txt",
    });

    const first = await app.inject({
      method: "POST",
      url: "/api/forum/attachments/attachment-sample/purchase",
      headers: { "x-user-id": "reader" },
    });
    expect(first.json()).toMatchObject({
      buyerBalance: 40,
      authorIncome: 7,
      alreadyPurchased: false,
    });
    const duplicate = await app.inject({
      method: "POST",
      url: "/api/forum/attachments/attachment-sample/purchase",
      headers: { "x-user-id": "reader" },
    });
    expect(duplicate.json()).toMatchObject({
      buyerBalance: 40,
      authorIncome: 7,
      alreadyPurchased: true,
    });

    editDatabase((database) => {
      database
        .prepare("UPDATE wallets SET balance = 5 WHERE user_id = 'wanderer'")
        .run();
    });
    const insufficient = await app.inject({
      method: "POST",
      url: "/api/forum/attachments/attachment-sample/purchase",
      headers: { "x-user-id": "wanderer" },
    });
    expect(insufficient.statusCode).toBe(402);
    expect(insufficient.json().error).toMatchObject({
      code: "INSUFFICIENT_COINS",
      details: { balance: 5, price: 10 },
    });

    const missing = await app.inject({
      method: "GET",
      url: "/api/forum/attachments/no-attachment",
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("ATTACHMENT_NOT_FOUND");
  });

  it("验证投票资格、选项约束、覆盖投票和实名分页", async () => {
    const poll = await app.inject({
      method: "GET",
      url: "/api/forum/polls/poll-route",
      headers: { "x-user-id": "reader" },
    });
    expect(poll.json()).toMatchObject({
      eligible: true,
      multiple: false,
      viewerOptionIds: [],
    });
    expect(poll.json().options).toHaveLength(3);

    const tooMany = await app.inject({
      method: "POST",
      url: "/api/forum/polls/poll-route/votes",
      headers: { "x-user-id": "reader" },
      payload: { optionIds: ["poll-option-tower", "poll-option-dock"] },
    });
    expect(tooMany.statusCode).toBe(422);
    expect(tooMany.json().error.code).toBe("POLL_SINGLE_CHOICE");
    const unknownOption = await app.inject({
      method: "POST",
      url: "/api/forum/polls/poll-route/votes",
      headers: { "x-user-id": "reader" },
      payload: { optionIds: ["not-an-option"] },
    });
    expect(unknownOption.statusCode).toBe(404);
    expect(unknownOption.json().error.code).toBe("POLL_OPTION_NOT_FOUND");

    const readerVote = await app.inject({
      method: "POST",
      url: "/api/forum/polls/poll-route/votes",
      headers: { "x-user-id": "reader" },
      payload: { optionIds: ["poll-option-tower"] },
    });
    expect(readerVote.json().viewerOptionIds).toEqual(["poll-option-tower"]);
    const overwritten = await app.inject({
      method: "POST",
      url: "/api/forum/polls/poll-route/votes",
      headers: { "x-user-id": "reader" },
      payload: { optionIds: ["poll-option-dock"] },
    });
    expect(overwritten.json().viewerOptionIds).toEqual(["poll-option-dock"]);
    await app.inject({
      method: "POST",
      url: "/api/forum/polls/poll-route/votes",
      headers: { "x-user-id": "wanderer" },
      payload: { optionIds: ["poll-option-tower"] },
    });

    const voters = await app.inject({
      method: "GET",
      url: "/api/forum/polls/poll-route/votes?limit=1",
    });
    expect(voters.json().items).toHaveLength(1);
    expect(voters.json().items[0]).toMatchObject({
      user: { id: expect.any(String) },
      optionIds: [expect.any(String)],
    });
    expect(voters.json().pageInfo.nextCursor).toEqual(expect.any(String));
    const nextPage = await app.inject({
      method: "GET",
      url: `/api/forum/polls/poll-route/votes?limit=1&cursor=${voters.json().pageInfo.nextCursor as string}`,
    });
    expect(nextPage.json().items).toHaveLength(1);
    expect(nextPage.json().items[0].user.id).not.toBe(
      voters.json().items[0].user.id,
    );
    const badCursor = await app.inject({
      method: "GET",
      url: "/api/forum/polls/poll-route/votes?cursor=missing-vote",
    });
    expect(badCursor.statusCode).toBe(422);
    expect(badCursor.json().error.code).toBe("INVALID_CURSOR");

    editDatabase((database) => {
      database
        .prepare(
          "UPDATE polls SET minimum_role = 'author' WHERE id = 'poll-route'",
        )
        .run();
    });
    const ineligiblePoll = await app.inject({
      method: "GET",
      url: "/api/forum/polls/poll-route",
      headers: { "x-user-id": "reader" },
    });
    expect(ineligiblePoll.json().eligible).toBe(false);
    const ineligibleVote = await app.inject({
      method: "POST",
      url: "/api/forum/polls/poll-route/votes",
      headers: { "x-user-id": "reader" },
      payload: { optionIds: ["poll-option-tower"] },
    });
    expect(ineligibleVote.statusCode).toBe(403);
    expect(ineligibleVote.json().error.code).toBe("POLL_INELIGIBLE");

    const missingPoll = await app.inject({
      method: "GET",
      url: "/api/forum/polls/no-poll",
    });
    expect(missingPoll.statusCode).toBe(404);
    expect(missingPoll.json().error.code).toBe("POLL_NOT_FOUND");
  });
});
