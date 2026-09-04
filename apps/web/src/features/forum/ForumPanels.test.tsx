import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { identities, seedRevisions } from "../../lib/seed";
import type { RichTextNode } from "../../lib/types";
import { ChapterRail, ForumBusinessPanel, HistoryPanel } from "./ForumPanels";

const mocks = vi.hoisted(() => ({
  getRevisionsMock: vi.fn(),
  listSuggestionBatchesMock: vi.fn(),
  listSuggestionsMock: vi.fn(),
  reviewSuggestionBatchMock: vi.fn(),
  reviewSuggestionMock: vi.fn(),
  getAttachmentMock: vi.fn(),
  purchaseAttachmentMock: vi.fn(),
  getPollMock: vi.fn(),
  votePollMock: vi.fn(),
  getPollVotesMock: vi.fn(),
}));

vi.mock("../../lib/api/revisions", () => ({
  getRevisions: mocks.getRevisionsMock,
}));

vi.mock("../../lib/api/suggestions", () => ({
  listSuggestionBatches: mocks.listSuggestionBatchesMock,
  listSuggestions: mocks.listSuggestionsMock,
  reviewSuggestionBatch: mocks.reviewSuggestionBatchMock,
  reviewSuggestion: mocks.reviewSuggestionMock,
}));

vi.mock("../../lib/api/attachments", () => ({
  getAttachment: mocks.getAttachmentMock,
  purchaseAttachment: mocks.purchaseAttachmentMock,
}));

vi.mock("../../lib/api/polls", () => ({
  getPoll: mocks.getPollMock,
  votePoll: mocks.votePollMock,
  getPollVotes: mocks.getPollVotesMock,
}));

function renderWithQuery(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}

const chaptersFixture = [
  { id: "chapter-0", title: "楔子 · 雨季之前" },
  { id: "chapter-1", title: "第一章 · 潮汐表" },
  { id: "chapter-2", title: "第二章 · 陌生船票" },
  { id: "chapter-3", title: "第三章 · 没有寄件人的信" },
  { id: "chapter-4", title: "第四章 · 待发布" },
];

const attachmentContent: RichTextNode = {
  type: "doc",
  content: [
    {
      type: "attachmentRef",
      attrs: { attachmentId: "attachment-sample" },
    },
  ],
};

const pollContent: RichTextNode = {
  type: "doc",
  content: [{ type: "pollRef", attrs: { pollId: "poll-route" } }],
};

const pendingSuggestions = [
  {
    id: "s1",
    documentId: "demo-post",
    chapterId: "chapter-0",
    chapterTitle: "楔子 · 雨季之前",
    lineNo: 2,
    lineText: "雨季开始前的第七天，港口送走了最后一班客船。雾线从海面爬上来，把整条长街泡得发软。",
    fromText: "渡口的汽笛",
    toText: "港口的汽笛",
    reason: "与第一章地名保持一致",
    status: "pending" as const,
    authorId: "reader",
    reviewerId: null,
    createdAt: "2026-08-20T08:00:00.000Z",
  },
  {
    id: "s2",
    documentId: "demo-post",
    chapterId: "chapter-1",
    chapterTitle: "第一章 · 潮汐表",
    lineNo: 3,
    lineText: "灯塔管理员翻着泛黄的潮汐表说，今夜没有雾，却有风。",
    fromText: "她握紧信封",
    toText: "她攥紧信封",
    reason: "减少相邻段落用词重复",
    status: "pending" as const,
    authorId: "wanderer",
    reviewerId: null,
    createdAt: "2026-08-20T09:00:00.000Z",
  },
];

const forumPoll = {
  id: "poll-route",
  question: "下一章先去哪里？",
  multiple: false,
  eligible: true,
  options: [
    { id: "poll-option-tower", label: "钟楼", votes: 28 },
    { id: "poll-option-dock", label: "旧码头", votes: 19 },
    { id: "poll-option-library", label: "潮汐图书馆", votes: 11 },
  ],
  viewerOptionIds: [] as string[],
};

const freeAttachment = {
  id: "attachment-sample",
  name: "雾港设定集.txt",
  mimeType: "text/plain",
  price: 10,
  purchased: false,
  downloadUrl: null,
};

describe("ForumPanels", () => {
  it("正式目录按卷分组并支持收起展开", () => {
    renderWithQuery(
      <ChapterRail
        chapters={[
          { id: "a", title: "第1章开始", volumeTitle: "第一卷 幼儿园卷" },
          { id: "b", title: "第2章成长", volumeTitle: "第一卷 幼儿园卷" },
          { id: "c", title: "第3章入学", volumeTitle: "第二卷 小学卷" },
        ]}
        currentIndex={2}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "收起卷 第一卷 幼儿园卷" }),
    );
    expect(screen.queryByText("第1章开始")).not.toBeInTheDocument();
    expect(screen.getByText("第3章入学")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "展开卷 第一卷 幼儿园卷" }),
    );
    expect(screen.getByText("第2章成长")).toBeInTheDocument();
  });

  beforeEach(() => {
    mocks.getRevisionsMock.mockReset();
    mocks.getRevisionsMock.mockResolvedValue(seedRevisions);
    mocks.listSuggestionBatchesMock.mockReset().mockResolvedValue([]);
    mocks.reviewSuggestionBatchMock.mockReset();
    mocks.listSuggestionsMock.mockReset();
    mocks.listSuggestionsMock.mockResolvedValue(
      structuredClone(pendingSuggestions),
    );
    mocks.reviewSuggestionMock.mockReset();
    mocks.reviewSuggestionMock.mockImplementation(
      async (id: string, decision: string) => {
        // 真实 API 语义：审核后列表查询返回更新后的状态。
        const reviewed = pendingSuggestions.map((suggestion) =>
          suggestion.id === id
            ? {
                ...suggestion,
                status:
                  decision === "approve"
                    ? ("approved" as const)
                    : ("rejected" as const),
                reviewerId: "author",
              }
            : suggestion,
        );
        mocks.listSuggestionsMock.mockResolvedValue(reviewed);
        return {
          suggestion: reviewed.find((suggestion) => suggestion.id === id)!,
          document: null,
        };
      },
    );
    mocks.getAttachmentMock.mockReset();
    mocks.getAttachmentMock.mockResolvedValue(structuredClone(freeAttachment));
    mocks.purchaseAttachmentMock.mockReset();
    mocks.purchaseAttachmentMock.mockImplementation(async () => {
      // 真实 API 语义：购买后附件查询返回已购状态。
      mocks.getAttachmentMock.mockResolvedValue(
        structuredClone({ ...freeAttachment, purchased: true }),
      );
      return {
        attachment: { ...freeAttachment, purchased: true },
        buyerBalance: 40,
        authorIncome: 7,
        alreadyPurchased: false,
      };
    });
    mocks.getPollMock.mockReset();
    mocks.getPollMock.mockResolvedValue(structuredClone(forumPoll));
    mocks.votePollMock.mockReset();
    mocks.votePollMock.mockImplementation(
      async (_id: string, optionIds: string[]) => {
        // 真实 API 语义：投票后轮询查询返回更新后的票数。
        const updated = {
          ...structuredClone(forumPoll),
          viewerOptionIds: optionIds,
          options: forumPoll.options.map((option) => ({
            ...option,
            votes: option.votes + (optionIds.includes(option.id) ? 1 : 0),
          })),
        };
        mocks.getPollMock.mockResolvedValue(updated);
        return updated;
      },
    );
    mocks.getPollVotesMock.mockReset();
    mocks.getPollVotesMock.mockResolvedValue({
      items: [
        {
          user: { id: "reader", name: "晚风翻页", role: "reader" },
          optionIds: ["poll-option-tower"],
          createdAt: "2026-08-20T10:00:00.000Z",
        },
        {
          user: { id: "wanderer", name: "纸页留声", role: "reader" },
          optionIds: ["poll-option-dock"],
          createdAt: "2026-08-20T11:00:00.000Z",
        },
      ],
      pageInfo: { nextCursor: null },
    });
  });

  it("展示章节目录、当前章节和章节总结（真实字数与修订）", () => {
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={1}
        onSelect={vi.fn()}
        activeCharCount={3842}
        activeRevision={18}
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "章节目录" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^第一章/ }),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByRole("button", { name: /^第三章/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("创作中")).toBeInTheDocument();
    expect(screen.getByText("章节总结")).toBeInTheDocument();
    expect(screen.getByText("3,842")).toBeInTheDocument();
    expect(screen.getByText("18")).toBeInTheDocument();
  });

  it("没有统计数据时章节总结显示占位", () => {
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(screen.getByText("章节总结")).toBeInTheDocument();
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("目录底部提供「新增章节」入口并触发回调", () => {
    const onAddChapter = vi.fn();
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={0}
        onSelect={vi.fn()}
        onAddChapter={onAddChapter}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /新增章节/ }));
    expect(onAddChapter).toHaveBeenCalledTimes(1);
  });

  it("空库时同一入口显示红色创建文章按钮", () => {
    const onCreate = vi.fn();
    renderWithQuery(
      <ChapterRail
        chapters={[]}
        currentIndex={0}
        onSelect={vi.fn()}
        onAddChapter={onCreate}
        createArticle
      />,
    );
    const button = screen.getByRole("button", { name: "创建文章" });
    expect(button).toHaveClass("bg-destructive");
    fireEvent.click(button);
    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("未提供 onAddChapter 时隐藏新增章节入口", () => {
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={0}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.queryByRole("button", { name: /新增章节/ }),
    ).not.toBeInTheDocument();
  });

  it("章节行右向箭头弹出操作窗，删除确认后触发回调", () => {
    const onDelete = vi.fn();
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={1}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /打开章节操作 第二章/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /删除章节/ }));
    expect(
      screen.getByRole("alertdialog", { name: "删除章节" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/第二章 · 陌生船票/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith(2);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("删除确认可以取消，不触发回调", () => {
    const onDelete = vi.fn();
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={0}
        onSelect={vi.fn()}
        onDelete={onDelete}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /打开章节操作 楔子/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /删除章节/ }));
    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(onDelete).not.toHaveBeenCalled();
  });

  it("发布章节删除确认明确提示立即删除服务器正文", () => {
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={0}
        onSelect={vi.fn()}
        onDelete={vi.fn()}
        deleteMode="server"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /打开章节操作 楔子/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /删除章节/ }));
    expect(screen.getByText(/立即从服务器删除/)).toBeInTheDocument();
  });

  it("未提供 onDelete 时操作弹窗不渲染删除按钮", () => {
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={0}
        onSelect={vi.fn()}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /打开章节操作 楔子/ }),
    );
    expect(
      screen.queryByRole("button", { name: /删除章节/ }),
    ).not.toBeInTheDocument();
  });

  it("操作弹窗提供隐藏/恢复与校订入口并触发回调", () => {
    const onToggleHidden = vi.fn();
    const onProofread = vi.fn();
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={1}
        onSelect={vi.fn()}
        hiddenChapters={[false, true, false, false, false]}
        onToggleHidden={onToggleHidden}
        onProofread={onProofread}
      />,
    );
    // 已隐藏章节：行内显示「已隐藏」，弹窗显示「取消隐藏」。
    expect(screen.getByText("已隐藏")).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: /打开章节操作 第一章/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /取消隐藏/ }));
    expect(onToggleHidden).toHaveBeenCalledWith(1, false);
    // 未隐藏章节：弹窗显示「隐藏章节」，校订入口与阅读页图标一致（GitCompareArrows）。
    fireEvent.click(
      screen.getByRole("button", { name: /打开章节操作 楔子/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /隐藏章节/ }));
    expect(onToggleHidden).toHaveBeenCalledWith(0, true);
    fireEvent.click(
      screen.getByRole("button", { name: /打开章节操作 第一章/ }),
    );
    fireEvent.click(screen.getByRole("button", { name: /校订章节/ }));
    expect(onProofread).toHaveBeenCalledWith(1);
  });

  it("点击章节触发切换回调", () => {
    const onSelect = vi.fn();
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={1}
        onSelect={onSelect}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /^第二章/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("校订列表只显示当前章节，并保留章节与行定位", async () => {
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[0]!}
        documentId="demo-post"
        baseRevision={18}
        chapterId="chapter-0"
        chapterTitle="楔子 · 雨季之前"
        onRestore={vi.fn()}
      />,
    );
    expect(await screen.findByText("楔子 · 雨季之前")).toBeInTheDocument();
    expect(screen.getByText("第 2 行")).toBeInTheDocument();
    expect(screen.getByText("读者")).toBeInTheDocument();
    expect(screen.queryByText("reader")).not.toBeInTheDocument();
    const location = screen.getByLabelText("校订位置");
    expect(location.querySelector("dl")).toHaveClass("flex-col");
    expect(location).toHaveTextContent(pendingSuggestions[0]!.lineText);
    expect(screen.queryByText("第一章 · 潮汐表")).not.toBeInTheDocument();
    expect(screen.queryByText("第 3 行")).not.toBeInTheDocument();
  });

  it("编辑页右栏通过状态 Tab 查看已接受和已拒绝记录", async () => {
    mocks.listSuggestionsMock.mockResolvedValue([
      { ...pendingSuggestions[0]!, status: "approved", reason: "已接受记录" },
      {
        ...pendingSuggestions[0]!,
        id: "rejected-item",
        status: "rejected",
        reason: "已拒绝记录",
      },
    ]);
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[0]!}
        documentId="demo-post"
        baseRevision={18}
        chapterId="chapter-0"
        chapterTitle="楔子 · 雨季之前"
        onRestore={vi.fn()}
      />,
    );

    expect(await screen.findByRole("tab", { name: /待审核.*0/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /已接受.*1/ }));
    expect(screen.getByText("已接受记录")).toBeInTheDocument();
    expect(screen.queryByText("已拒绝记录")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: /已拒绝.*1/ }));
    expect(screen.getByText("已拒绝记录")).toBeInTheDocument();
    expect(screen.queryByText("已接受记录")).not.toBeInTheDocument();
  });

  it("接受校订建议调用审核 API并显示已合并状态", async () => {
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[0]!}
        documentId="demo-post"
        baseRevision={18}
        chapterId="chapter-0"
        chapterTitle="楔子 · 雨季之前"
        onRestore={vi.fn()}
      />,
    );
    fireEvent.click(
      (await screen.findAllByRole("button", { name: /接受/ }))[0]!,
    );
    await waitFor(() =>
      expect(mocks.reviewSuggestionMock).toHaveBeenCalledWith(
        "s1",
        "approve",
        18,
      ),
    );
    fireEvent.click(screen.getByRole("tab", { name: /已接受/ }));
    expect(await screen.findByText("已合并并建版")).toBeInTheDocument();
  });

  it("当前章节没有引用节点时隐藏附件和投票入口", () => {
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[0]!}
        documentId="demo-post"
        baseRevision={18}
        chapterId="chapter-0"
        chapterTitle="楔子 · 雨季之前"
        activeContent={{ type: "doc", content: [{ type: "paragraph" }] }}
        onRestore={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "附件" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "投票" })).not.toBeInTheDocument();
    expect(mocks.getAttachmentMock).not.toHaveBeenCalled();
    expect(mocks.getPollMock).not.toHaveBeenCalled();
  });

  it("附件购买并展示 70% 作者分成", async () => {
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[1]!}
        documentId="demo-post"
        baseRevision={18}
        chapterId="chapter-0"
        chapterTitle="楔子 · 雨季之前"
        activeContent={attachmentContent}
        onRestore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "附件" }));
    expect(await screen.findByText("作者获得 7（70%）")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "购买附件" }));
    await waitFor(() =>
      expect(mocks.purchaseAttachmentMock).toHaveBeenCalledWith(
        "attachment-sample",
      ),
    );
    expect(
      await screen.findByRole("button", { name: "已购买，可下载" }),
    ).toBeDisabled();
  });

  it("金币不足时禁止购买附件", async () => {
    renderWithQuery(
      <ForumBusinessPanel
        identity={{ ...identities[1]!, coins: 5 }}
        documentId="demo-post"
        baseRevision={18}
        chapterId="chapter-0"
        chapterTitle="楔子 · 雨季之前"
        activeContent={attachmentContent}
        onRestore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "附件" }));
    expect(
      await screen.findByRole("button", { name: "金币不足" }),
    ).toBeDisabled();
  });

  it("读者可以选择投票并展开实名明细", async () => {
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[1]!}
        documentId="demo-post"
        baseRevision={18}
        chapterId="chapter-0"
        chapterTitle="楔子 · 雨季之前"
        activeContent={pollContent}
        onRestore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "投票" }));
    const towerOption = await screen.findByRole("button", { name: /钟楼.*28 票/ });
    expect(towerOption).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(towerOption);
    await waitFor(() =>
      expect(mocks.votePollMock).toHaveBeenCalledWith("poll-route", [
        "poll-option-tower",
      ]),
    );
    const selectedOption = await screen.findByRole("button", {
      name: /钟楼.*29 票.*已选/,
    });
    expect(selectedOption).toHaveAttribute("aria-pressed", "true");
    expect(selectedOption).toHaveAttribute("data-state", "selected");
    fireEvent.click(screen.getByRole("button", { name: "查看实名投票明细" }));
    expect(await screen.findByText("晚风翻页 → 钟楼")).toBeInTheDocument();
  });

  it("加载历史并把目标版本交给回滚回调", async () => {
    const onRestore = vi.fn();
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[0]!}
        documentId="post_7"
        baseRevision={18}
        chapterId="chapter-0"
        chapterTitle="楔子 · 雨季之前"
        onRestore={onRestore}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "历史" }));

    expect(await screen.findByText("版本 18")).toBeInTheDocument();
    expect(mocks.getRevisionsMock).toHaveBeenCalledWith(
      "post_7",
      "chapter-0",
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "回退" })[1]!);
    expect(screen.getByRole("alertdialog", { name: "确认回退版本" })).toBeInTheDocument();
    expect(onRestore).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "确认回退" }));
    expect(onRestore).toHaveBeenCalledWith(17);
  });

  it("HistoryPanel 支持空列表和直接回退", () => {
    const onRestore = vi.fn();
    const { rerender } = render(
      <HistoryPanel revisions={[]} onRestore={onRestore} />,
    );
    expect(
      screen.queryByRole("button", { name: "回退" }),
    ).not.toBeInTheDocument();

    rerender(
      <HistoryPanel
        revisions={seedRevisions.slice(0, 1)}
        onRestore={onRestore}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "回退" }));
    fireEvent.click(screen.getByRole("button", { name: "确认回退" }));
    expect(onRestore).toHaveBeenCalledWith(18);
  });
});
