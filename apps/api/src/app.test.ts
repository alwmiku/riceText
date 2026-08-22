import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
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
    const saved = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-demo-user": "author" }, payload: request });
    expect(saved.statusCode, saved.body).toBe(201);
    expect(saved.json().revision).toBe(2);

    const retried = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-demo-user": "author" }, payload: request });
    expect(retried.statusCode).toBe(200);
    expect(retried.json().revision).toBe(2);

    const conflict = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-demo-user": "author" }, payload: { ...request, clientMutationId: "save-stale" } });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.details.currentRevision).toBe(2);

    const rolledBack = await app.inject({ method: "POST", url: "/api/documents/demo-post/rollback", headers: { "x-demo-user": "moderator" }, payload: { baseRevision: 2, targetRevision: 1, clientMutationId: "rollback-one" } });
    expect(rolledBack.statusCode).toBe(201);
    expect(rolledBack.json().revision).toBe(3);
    expect(rolledBack.json().content.content[0].type).toBe("heading");

    const history = await app.inject({ method: "GET", url: "/api/documents/demo-post/revisions?limit=2" });
    expect(history.statusCode).toBe(200);
    expect(history.json().items.map((item: { revision: number }) => item.revision)).toEqual([3, 2]);
    expect(history.json().pageInfo.nextCursor).toBe("2");
  });

  it("保存时仅递增本次编辑章节的版本号", async () => {
    const directoryBefore = (await app.inject({ method: "GET", url: "/api/demo/chapters" })).json().items as Array<{ id: string; revision: number }>;
    const chapterOneBefore = directoryBefore.find((item) => item.id === "chapter-1")!;
    const chapterTwoBefore = directoryBefore.find((item) => item.id === "chapter-2")!;
    expect(chapterOneBefore.revision).toBe(1);
    expect(chapterTwoBefore.revision).toBe(1);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/documents/demo-post",
      headers: { "x-demo-user": "author" },
      payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "chapter-save", chapterId: "chapter-1", content: validContent() },
    });
    expect(saved.statusCode).toBe(201);

    const directoryAfter = (await app.inject({ method: "GET", url: "/api/demo/chapters" })).json().items as Array<{ id: string; revision: number }>;
    expect(directoryAfter.find((item) => item.id === "chapter-1")!.revision).toBe(2);
    expect(directoryAfter.find((item) => item.id === "chapter-2")!.revision).toBe(1);
  });

  it("拒绝 reader 写入和不安全正文", async () => {
    const forbidden = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-demo-user": "reader" }, payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "reader-save", content: validContent() } });
    expect(forbidden.statusCode).toBe(403);

    const unsafe = await app.inject({ method: "PUT", url: "/api/documents/demo-post", headers: { "x-demo-user": "author" }, payload: { schemaVersion: 1, baseRevision: 1, clientMutationId: "unsafe-save", content: { type: "doc", content: [{ type: "richImage", attrs: { src: "data:image/png;base64,AAAA", align: "center", width: 80 } }] } } });
    expect(unsafe.statusCode).toBe(422);
    expect(unsafe.json().error.code).toBe("UNSAFE_IMAGE_URL");
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

    const reply = await app.inject({ method: "POST", url: "/api/documents/demo-post/comments/anchor-opening/replies", headers: { "x-demo-user": "reader" }, payload: { parentId: null, body: "新根回复" } });
    expect(reply.statusCode).toBe(201);
    const replyId = reply.json().id as string;
    const vote = await app.inject({ method: "PUT", url: `/api/comments/replies/${replyId}/vote`, headers: { "x-demo-user": "author" }, payload: { value: 1 } });
    expect(vote.json()).toEqual({ score: 1, viewerVote: 1, upvotes: 1, downvotes: 0, myVote: 1 });
    const newest = await app.inject({ method: "GET", url: "/api/documents/demo-post/comments/anchor-opening?sort=newest", headers: { "x-demo-user": "author" } });
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

  it("演示 @、回复可见、附件 70% 分成和实名投票", async () => {
    const mention = await app.inject({ method: "POST", url: "/api/demo/mentions/resolve", payload: { name: "远舟" } });
    expect(mention.json().resolved).toBe(true);

    const hidden = await app.inject({ method: "POST", url: "/api/demo/reply-gates/resolve", headers: { "x-demo-user": "wanderer" }, payload: { gateId: "gate-bonus", documentId: "demo-post" } });
    expect(hidden.json().visible).toBe(false);
    await app.inject({ method: "POST", url: "/api/documents/demo-post/comments/anchor-opening/replies", headers: { "x-demo-user": "wanderer" }, payload: { parentId: null, body: "已回复" } });
    const visible = await app.inject({ method: "POST", url: "/api/demo/reply-gates/resolve", headers: { "x-demo-user": "wanderer" }, payload: { gateId: "gate-bonus", documentId: "demo-post" } });
    expect(visible.json().visible).toBe(true);

    const purchase = await app.inject({ method: "POST", url: "/api/demo/attachments/attachment-sample/purchase", headers: { "x-demo-user": "reader" } });
    expect(purchase.json().authorIncome).toBe(7);
    expect(purchase.json().buyerBalance).toBe(40);
    const duplicate = await app.inject({ method: "POST", url: "/api/demo/attachments/attachment-sample/purchase", headers: { "x-demo-user": "reader" } });
    expect(duplicate.json().alreadyPurchased).toBe(true);
    expect(duplicate.json().buyerBalance).toBe(40);

    const voted = await app.inject({ method: "POST", url: "/api/demo/polls/poll-route/votes", headers: { "x-demo-user": "reader" }, payload: { optionIds: ["poll-option-tower"] } });
    expect(voted.statusCode).toBe(200);
    expect(voted.json().viewerOptionIds).toEqual(["poll-option-tower"]);
    const voters = await app.inject({ method: "GET", url: "/api/demo/polls/poll-route/votes", headers: { "x-demo-user": "author" } });
    expect(voters.json().items[0].user.id).toBe("reader");
  });

  it("审核建议会创建真实 suggestion 修订", async () => {
    const submitted = await app.inject({ method: "POST", url: "/api/demo/documents/demo-post/suggestions", headers: { "x-demo-user": "reader" }, payload: { fromText: "潮声", toText: "海潮声", reason: "措辞更清楚" } });
    expect(submitted.statusCode).toBe(201);
    const reviewed = await app.inject({ method: "PATCH", url: `/api/demo/suggestions/${submitted.json().id}`, headers: { "x-demo-user": "author" }, payload: { decision: "approve", baseRevision: 1 } });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().suggestion.status).toBe("approved");
    expect(reviewed.json().document.revision).toBe(2);
    const history = await app.inject({ method: "GET", url: "/api/documents/demo-post/revisions" });
    expect(history.json().items[0].operation).toBe("suggestion");
  });
});
