import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { diffDocuments } from "@ricetext/document-core";
import { createApp } from "./app.js";

const validContent = (text = "新的正文") => ({
  type: "doc" as const,
  content: [{ type: "paragraph", attrs: { textAlign: null }, content: [{ type: "text", text }, { type: "inlineCommentAnchor", attrs: { threadId: "anchor-opening", count: 2, placement: "end" } }] }],
});

describe("RiceText API", () => {
  let directory: string;
  let app: FastifyInstance;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "ricetext-api-"));
    app = await createApp({ databasePath: join(directory, "test.sqlite"), uploadsDirectory: join(directory, "uploads"), logger: false });
  });

  afterEach(async () => {
    if (app) await app.close();
    await rm(directory, { recursive: true, force: true });
  });

  it("读取种子文档并执行幂等保存、冲突和非破坏回滚", async () => {
    const initial = await app.inject({ method: "GET", url: "/api/documents/demo-post" });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().revision).toBe(1);

    const request = { schemaVersion: 1, baseRevision: 1, clientMutationId: "save-one", content: validContent() };
    const saved = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-user-id": "author" }, payload: request });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().revision).toBe(2);

    const retried = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-user-id": "author" }, payload: request });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().revision).toBe(2);

    const conflict = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-user-id": "author" }, payload: { ...request, clientMutationId: "save-stale" } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.details.currentRevision).toBe(2);

    const rolledBack = await app.inject({ method: "POST", url: "/api/documents/demo-post/rollback", headers: { "x-user-id": "moderator" }, payload: { baseRevision: 2, targetRevision: 1, clientMutationId: "rollback-one" } });
    expect(rolledBack.statusCode).toBe(201);
    expect(rolledBack.json().revision).toBe(3);
    expect(rolledBack.json().content.content[0].type).toBe("heading");

    const history = await app.inject({ method: "GET", url: "/api/documents/demo-post/revisions?limit=2" });
    expect(history.statusCode).toBe(200);
    expect(history.json().items.map((item: { revision: number }) => item.revision)).toEqual([3, 2]);
    expect(history.json().pageInfo.nextCursor).toBe("2");
  });

  it("保存时仅递增本次编辑章节的版本号", async () => {
    const directoryBefore = (await app.inject({ method: "GET", url: "/api/forum/chapters" })).json().items as Array<{ id: string; revision: number }>;
    const chapterOneBefore = directoryBefore.find((item) => item.id === "chapter-1")!;
    const chapterTwoBefore = directoryBefore.find((item) => item.id === "chapter-2")!;
    expect(chapterOneBefore.revision).toBe(1);
    expect(chapterTwoBefore.revision).toBe(1);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
      payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "chapter-save", chapterId: "chapter-1", content: validContent() },
    });
    expect(saved.statusCode).toBe(201);

    const directoryAfter = (await app.inject({ method: "GET", url: "/api/forum/chapters" })).json().items as Array<{ id: string; revision: number }>;
    expect(directoryAfter.find((item) => item.id === "chapter-1")!.revision).toBe(2);
    expect(directoryAfter.find((item) => item.id === "chapter-2")!.revision).toBe(1);
  });

  it("拒绝 reader 写入和不安全正文", async () => {
    const forbidden = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-user-id": "reader" }, payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "reader-save", content: validContent() } });
    expect(forbidden.statusCode).toBe(403);

    const unsafe = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-user-id": "author" }, payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "unsafe-save", content: { type: "doc", content: [{ type: "richImage", attrs: { src: "data:image/png;base64,AAAA", align: "center", width: 80 } }] } } });
    expect(unsafe.statusCode).toBe(422);
    expect(unsafe.json().error.code).toBe("UNSAFE_URL");
  });

  it("持久化骰子，只有显式重投才创建新结果", async () => {
    const created = await app.inject({ method: "POST", url: "/api/dice", payload: { expression: "3d5" } });
    expect(created.statusCode).toBe(201);
    const first = created.json();
    const loaded = await app.inject({ method: "GET", url: `/api/dice/${first.rollId}` });
    expect(loaded.json()).toEqual(first);
    const rerolled = await app.inject({ method: "POST", url: `/api/dice/${first.rollId}/reroll` });
    expect(rerolled.statusCode).toBe(201);
    expect(rerolled.json().rollId).not.toBe(first.rollId);
    expect(rerolled.json().rootRollId).toBe(first.rootRollId);
    expect(rerolled.json().rerollOf).toBe(first.rollId);
  });

  it("返回间贴树并支持楼中楼、点赞与排序", async () => {
    const seeded = await app.inject({ method: "GET", url: "/api/documents/demo-post/comments/anchor-opening?sort=score" });
    expect(seeded.statusCode).toBe(200);
    expect(seeded.json().items[0].children).toHaveLength(1);

    const reply = await app.inject({ method: "POST", url: "/api/documents/demo-post/comments/anchor-opening/replies", headers: { "x-user-id": "reader" }, payload: { parentId: null, body: "新根回复" } });
    expect(reply.statusCode).toBe(201);
    const replyId = reply.json().id as string;
    const vote = await app.inject({ method: "PUT", url: `/api/comments/replies/${replyId}/vote`, headers: { "x-user-id": "author" }, payload: { value: 1 } });
    expect(vote.json()).toEqual({ score: 1, viewerVote: 1, upvotes: 1, downvotes: 0, myVote: 1 });
    const newest = await app.inject({ method: "GET", url: "/api/documents/demo-post/comments/anchor-opening?sort=newest", headers: { "x-user-id": "author" } });
    expect(newest.json().items[0].id).toBe(replyId);
  });

  it("校验图片签名并从独立文件返回上传内容", async () => {
    const boundary = "----RiceTextBoundary";
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="pixel.png"\r\nContent-Type: image/png\r\n\r\n`);
    const suffix = Buffer.from(`\r\n--${boundary}--\r\n`);
    const uploaded = await app.inject({ method: "POST", url: "/api/assets", headers: { "content-type": `multipart/form-data; boundary=${boundary}` }, payload: Buffer.concat([prefix, png, suffix]) });
    expect(uploaded.statusCode).toBe(201);
    const asset = uploaded.json();
    expect(asset.mimeType).toBe("image/png");
    const loaded = await app.inject({ method: "GET", url: asset.url });
    expect(loaded.statusCode).toBe(200);
    expect(loaded.rawPayload).toEqual(png);
    expect(await readFile(join(directory, "uploads", `${asset.id}.png`))).toEqual(png);
  });

  it("论坛 @、回复可见、附件 70% 分成和实名投票", async () => {
    const mention = await app.inject({ method: "POST", url: "/api/forum/mentions/resolve", payload: { name: "远舟" } });
    expect(mention.json().resolved).toBe(true);

    const hidden = await app.inject({ method: "POST", url: "/api/forum/reply-gates/resolve", headers: { "x-user-id": "wanderer" }, payload: { gateId: "gate-bonus", documentId: "demo-post" } });
    expect(hidden.json().visible).toBe(false);
    await app.inject({ method: "POST", url: "/api/documents/demo-post/comments/anchor-opening/replies", headers: { "x-user-id": "wanderer" }, payload: { parentId: null, body: "已回复" } });
    const visible = await app.inject({ method: "POST", url: "/api/forum/reply-gates/resolve", headers: { "x-user-id": "wanderer" }, payload: { gateId: "gate-bonus", documentId: "demo-post" } });
    expect(visible.json().visible).toBe(true);

    const purchase = await app.inject({ method: "POST", url: "/api/forum/attachments/attachment-sample/purchase", headers: { "x-user-id": "reader" } });
    expect(purchase.json().authorIncome).toBe(7);
    expect(purchase.json().buyerBalance).toBe(40);
    const duplicate = await app.inject({ method: "POST", url: "/api/forum/attachments/attachment-sample/purchase", headers: { "x-user-id": "reader" } });
    expect(duplicate.json().alreadyPurchased).toBe(true);
    expect(duplicate.json().buyerBalance).toBe(40);

    const voted = await app.inject({ method: "POST", url: "/api/forum/polls/poll-route/votes", headers: { "x-user-id": "reader" }, payload: { optionIds: ["poll-option-tower"] } });
    expect(voted.statusCode).toBe(200);
    expect(voted.json().viewerOptionIds).toEqual(["poll-option-tower"]);
    const voters = await app.inject({ method: "GET", url: "/api/forum/polls/poll-route/votes", headers: { "x-user-id": "author" } });
    expect(voters.json().items[0].user.id).toBe("reader");
  });

  it("审核建议会创建真实 suggestion 修订", async () => {
    const submitted = await app.inject({ method: "POST", url: "/api/forum/documents/demo-post/suggestions", headers: { "x-user-id": "reader" }, payload: { fromText: "潮声", toText: "海潮声", reason: "措辞更清楚" } });
    expect(submitted.statusCode).toBe(201);
    const reviewed = await app.inject({ method: "PATCH", url: `/api/forum/suggestions/${submitted.json().id}`, headers: { "x-user-id": "author" }, payload: { decision: "approve", baseRevision: 1 } });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().suggestion.status).toBe("approved");
    expect(reviewed.json().document.revision).toBe(2);
    const persisted = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
    });
    expect(JSON.stringify(persisted.json().content)).toContain("海潮声");
    const suggestions = await app.inject({
      method: "GET",
      url: "/api/forum/documents/demo-post/suggestions",
      headers: { "x-user-id": "author" },
    });
    expect(
      suggestions.json().items.find((item: { id: string }) => item.id === submitted.json().id),
    ).toMatchObject({ status: "approved", reviewerId: "author" });
    const history = await app.inject({ method: "GET", url: "/api/documents/demo-post/revisions" });
    expect(history.json().items[0].operation).toBe("suggestion");
  });

  it("接受空替换文本时从正文删除所选文字并持久化", async () => {
    const submitted = await app.inject({
      method: "POST",
      url: "/api/forum/documents/demo-post/suggestions",
      headers: { "x-user-id": "reader" },
      payload: {
        fromText: "潮声",
        toText: "",
        reason: "删除多余文字",
        chapterId: "chapter-1",
        chapterTitle: "第一章 潮汐表",
        lineNo: 2,
        lineText: "潮声沿着旧城墙漫上来，旅人把未寄出的信压在灯下。",
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    expect(submitted.json().toText).toBe("");

    const reviewed = await app.inject({
      method: "PATCH",
      url: `/api/forum/suggestions/${submitted.json().id}`,
      headers: { "x-user-id": "author" },
      payload: { decision: "approve", baseRevision: 1 },
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json().suggestion.status).toBe("approved");

    const persisted = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post",
    });
    const serialized = JSON.stringify(persisted.json().content);
    expect(serialized).toContain("沿着旧城墙漫上来");
    expect(serialized).not.toContain("潮声沿着旧城墙漫上来");
  });

  it("整章多处修订作为一个批次提交并原子创建一个版本", async () => {
    const current = (await app.inject({
      method: "GET",
      url: "/api/documents/demo-post",
    })).json();
    const after = structuredClone(current.content) as {
      content: Array<{ content?: Array<{ text?: string }> }>;
    };
    after.content[5]!.content![0]!.text = "潮声沿着旧城墙涌上来，旅人把未寄出的信压在灯下。";
    after.content[6]!.content![0]!.text = "灯塔管理员翻着崭新的潮汐表说，今夜没有雾，却有风。";
    const steps = diffDocuments(current.content, after);
    expect(steps.length).toBeGreaterThan(1);

    const submitted = await app.inject({
      method: "POST",
      url: "/api/forum/documents/demo-post/suggestion-batches",
      headers: { "x-user-id": "reader" },
      payload: {
        baseRevision: 1,
        chapterId: "chapter-1",
        chapterTitle: "第一章 潮汐表",
        beforeContent: {
          type: "doc",
          content: current.content.content.slice(4, 7),
        },
        afterContent: { type: "doc", content: after.content.slice(4, 7) },
        steps,
        reason: "统一两处措辞",
      },
    });
    expect(submitted.statusCode, submitted.body).toBe(201);
    expect(submitted.json()).toMatchObject({
      status: "pending",
      chapterId: "chapter-1",
      reason: "统一两处措辞",
    });

    const unrelated = structuredClone(current.content) as {
      content: Array<{ content?: Array<{ text?: string }> }>;
    };
    unrelated.content[0]!.content![0]!.text = "雾港来信（作者补充）";
    const savedElsewhere = await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-user-id": "author" },
      payload: {
        schemaVersion: 1,
        baseRevision: 1,
        clientMutationId: "unrelated-before-batch-review",
        content: unrelated,
      },
    });
    expect(savedElsewhere.statusCode, savedElsewhere.body).toBe(201);
    expect(savedElsewhere.json().revision).toBe(2);

    const reviewed = await app.inject({
      method: "PATCH",
      url: `/api/forum/suggestion-batches/${submitted.json().id}`,
      headers: { "x-user-id": "author" },
      payload: { decision: "approve", baseRevision: 2 },
    });
    expect(reviewed.statusCode, reviewed.body).toBe(200);
    expect(reviewed.json().batch.status).toBe("approved");
    expect(reviewed.json().document.revision).toBe(3);

    const persisted = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post",
    });
    const serialized = JSON.stringify(persisted.json().content);
    expect(serialized).toContain("雾港来信（作者补充）");
    expect(serialized).toContain("涌上来");
    expect(serialized).toContain("崭新的潮汐表");
    const history = await app.inject({
      method: "GET",
      url: "/api/documents/demo-post/revisions",
    });
    expect(history.json().items[0]).toMatchObject({
      revision: 3,
      operation: "suggestion",
    });
  });

  it("应用最小 steps 创建带溯源的新修订", async () => {
    const before = (await app.inject({ method: "GET", url: "/api/documents/demo-post" })).json().content as {
      content: Array<{ content: Array<{ text: string }> }>;
    };
    const after = structuredClone(before);
    after.content[0]!.content[0]!.text = "海港来信：第三章讨论与校订";
    const steps = diffDocuments(before, after);

    const applied = await app.inject({
      method: "PATCH",
      url: "/api/documents/demo-post/steps",
      headers: { "x-user-id": "author" },
      payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "steps-one", steps, chapterId: "chapter-0" },
    });
    expect(applied.statusCode, applied.body).toBe(201);
    expect(applied.json().revision).toBe(2);
    expect(applied.json().content.content[0].content[0].text).toBe("海港来信：第三章讨论与校订");

    // 幂等重试命中既有修订
    const retried = await app.inject({
      method: "PATCH",
      url: "/api/documents/demo-post/steps",
      headers: { "x-user-id": "author" },
      payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "steps-one", steps, chapterId: "chapter-0" },
    });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().revision).toBe(2);

    // 章节独立版本号递增
    const chapters = (await app.inject({ method: "GET", url: "/api/forum/chapters" })).json().items as Array<{ id: string; revision: number }>;
    expect(chapters.find((item) => item.id === "chapter-0")?.revision).toBe(2);
    expect(chapters.find((item) => item.id === "chapter-1")?.revision).toBe(1);

    // 历史修订带 steps 溯源描述
    const history = await app.inject({ method: "GET", url: "/api/documents/demo-post/revisions" });
    expect(history.json().items[0]).toMatchObject({ operation: "steps", summary: "应用增量编辑" });
    expect(typeof history.json().items[0].stepsSummary).toBe("string");
    expect(history.json().items[0].stepsSummary.length).toBeGreaterThan(0);
  });

  it("steps 应用拒绝权限不足、非法步骤与 revision 冲突", async () => {
    const steps = [{ stepType: "replace", from: 1, to: 2, slice: { content: [{ type: "text", text: "海" }], openStart: 0, openEnd: 0 } }];

    const forbidden = await app.inject({
      method: "PATCH",
      url: "/api/documents/demo-post/steps",
      headers: { "x-user-id": "reader" },
      payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "steps-denied", steps },
    });
    expect(forbidden.statusCode).toBe(403);

    const invalid = await app.inject({
      method: "PATCH",
      url: "/api/documents/demo-post/steps",
      headers: { "x-user-id": "author" },
      payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "steps-invalid", steps: [{ stepType: "replace", from: 9999, to: 10000, slice: { content: [], openStart: 0, openEnd: 0 } }] },
    });
    expect(invalid.statusCode).toBe(422);
    expect(invalid.json().error.code).toBe("INVALID_STEPS");

    await app.inject({
      method: "PATCH",
      url: "/api/documents/demo-post/steps",
      headers: { "x-user-id": "author" },
      payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "steps-conflict-base", steps },
    });
    const conflict = await app.inject({
      method: "PATCH",
      url: "/api/documents/demo-post/steps",
      headers: { "x-user-id": "author" },
      payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "steps-conflict", steps },
    });
    expect(conflict.statusCode).toBe(409);
  });
});
