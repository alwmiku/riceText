import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { identities, seedRevisions } from "../../lib/seed";
import { ChapterRail, ForumBusinessPanel, HistoryPanel } from "./ForumPanels";

const mocks = vi.hoisted(() => ({
  getRevisionsMock: vi.fn(),
  listSuggestionsMock: vi.fn(),
  reviewSuggestionMock: vi.fn(),
  getAttachmentMock: vi.fn(),
  purchaseAttachmentMock: vi.fn(),
  getPollMock: vi.fn(),
  votePollMock: vi.fn(),
  getPollVotesMock: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  getRevisions: mocks.getRevisionsMock,
  listSuggestions: mocks.listSuggestionsMock,
  reviewSuggestion: mocks.reviewSuggestionMock,
  getAttachment: mocks.getAttachmentMock,
  purchaseAttachment: mocks.purchaseAttachmentMock,
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

const pendingSuggestions = [
  {
    id: "s1",
    documentId: "demo-post",
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
  beforeEach(() => {
    mocks.getRevisionsMock.mockReset();
    mocks.getRevisionsMock.mockResolvedValue(seedRevisions);
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

  it("展示章节目录、当前章节和统计", () => {
    renderWithQuery(
      <ChapterRail
        chapters={chaptersFixture}
        currentIndex={1}
        onSelect={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("complementary", { name: "章节目录" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /第一章.*潮汐表/ }),
    ).toHaveAttribute("data-active", "true");
    expect(
      screen.getByRole("button", { name: /第三章.*没有寄件人的信/ }),
    ).toBeInTheDocument();
    expect(screen.getByText("3,842")).toBeInTheDocument();
    expect(screen.getByText("创作中")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /第二章.*陌生船票/ }));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("接受校订建议调用审核 API 并显示已合并状态", async () => {
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[0]!}
        documentId="demo-post"
        baseRevision={18}
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
    expect(await screen.findByText("已合并并建版")).toBeInTheDocument();
  });

  it("附件购买并展示 70% 作者分成", async () => {
    renderWithQuery(
      <ForumBusinessPanel
        identity={identities[1]!}
        documentId="demo-post"
        baseRevision={18}
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
        onRestore={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "投票" }));
    fireEvent.click(await screen.findByRole("button", { name: /钟楼.*28 票/ }));
    await waitFor(() =>
      expect(mocks.votePollMock).toHaveBeenCalledWith("poll-route", [
        "poll-option-tower",
      ]),
    );
    expect(
      await screen.findByRole("button", { name: /钟楼.*29 票/ }),
    ).toBeInTheDocument();
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
        onRestore={onRestore}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "历史" }));

    expect(await screen.findByText("版本 18")).toBeInTheDocument();
    expect(mocks.getRevisionsMock).toHaveBeenCalledWith(
      "post_7",
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getAllByRole("button", { name: "回退" })[1]!);
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
    expect(onRestore).toHaveBeenCalledWith(18);
  });
});
