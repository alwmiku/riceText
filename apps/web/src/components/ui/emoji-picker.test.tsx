import { fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  EmojiPicker,
  MAX_RECENT_EMOJI,
  RECENT_GROUP_ID,
  loadRecentEmojiIds,
  persistRecentEmojiId,
  resolvePickerEntries,
} from "./emoji-picker";

const RECENT_KEY = "ricetext:recent-emoji";

beforeEach(() => {
  window.localStorage.clear();
});

describe("表情面板的纯函数", () => {
  it("resolvePickerEntries：查询优先于分组，「最近」只列目录里仍存在的条目", () => {
    expect(resolvePickerEntries("custom", "", []).map((entry) => entry.id)).toContain("hug");
    // 有查询词时跨分组搜索，不再受当前页签限制。
    const searched = resolvePickerEntries("custom", "wx", []).map((entry) => entry.id);
    expect(searched).toContain("smile");
    // 分组不影响搜索：颜文字与站点表情同样可能命中同一个查询词。
    expect(resolvePickerEntries("kaomoji", "hug", []).map((entry) => entry.id)).toContain("hug");
    // 「最近」页签过滤掉已经下线、目录里查不到的 id。
    expect(
      resolvePickerEntries(RECENT_GROUP_ID, "", ["water", "removed-emoji"]).map(
        (entry) => entry.id,
      ),
    ).toEqual(["water"]);
    expect(resolvePickerEntries("unknown-group", "", [])).toEqual([]);
  });

  it("最近使用：去重置顶、限制条数、损坏数据静默降级", () => {
    for (let index = 0; index < MAX_RECENT_EMOJI + 4; index += 1) {
      persistRecentEmojiId(`emoji-${index}`);
    }
    const stored = loadRecentEmojiIds();
    expect(stored).toHaveLength(MAX_RECENT_EMOJI);
    expect(stored[0]).toBe(`emoji-${MAX_RECENT_EMOJI + 3}`);

    persistRecentEmojiId("emoji-5");
    expect(loadRecentEmojiIds()[0]).toBe("emoji-5");
    expect(new Set(loadRecentEmojiIds()).size).toBe(loadRecentEmojiIds().length);

    window.localStorage.setItem(RECENT_KEY, "{ 不是 JSON");
    expect(loadRecentEmojiIds()).toEqual([]);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify([1, "chips", null]));
    expect(loadRecentEmojiIds()).toEqual(["chips"]);
  });
});

describe("EmojiPicker 交互", () => {
  it("默认展示站点表情，点击后回调对应条目并写入最近使用", () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    const panel = screen.getByRole("group", { name: "表情选择器" });
    expect(panel).toBeInTheDocument();

    fireEvent.click(within(panel).getByRole("option", { name: "抱抱" }));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(onPick.mock.calls[0]![0].id).toBe("hug");
    expect(loadRecentEmojiIds()[0]).toBe("hug");
  });

  it("搜索命中快捷码与中文名，清空后回到当前分组", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    const search = screen.getByLabelText("搜索表情");

    fireEvent.change(search, { target: { value: "hh" } });
    const hhOptions = screen.getAllByRole("option");
    expect(hhOptions.length).toBeGreaterThan(0);
    expect(hhOptions[0]!.getAttribute("aria-label")).toBe("害羞");

    fireEvent.change(search, { target: { value: "颜文字不存在" } });
    expect(screen.getByRole("status")).toHaveTextContent("没有匹配的表情");

    fireEvent.change(search, { target: { value: "" } });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("切换分组页签会更新列表与选中态", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    const tabs = screen.getAllByRole("tab");
    const kaomoji = tabs.find((tab) => tab.textContent === "颜文字")!;
    expect(kaomoji.getAttribute("aria-selected")).toBe("false");
    fireEvent.click(kaomoji);
    expect(kaomoji.getAttribute("aria-selected")).toBe("true");
    // 颜文字分组全是纯文本条目，网格里应出现颜文字名字。
    expect(screen.getByRole("option", { name: "鞠躬" })).toBeInTheDocument();
  });

  it("面板内点击不会让编辑器丢选区：mousedown 全部被阻止默认", () => {
    render(<EmojiPicker onPick={vi.fn()} />);
    // 搜索框保持可聚焦（否则用户没法输入），页签与表情项则必须阻止默认。
    expect(fireEvent.mouseDown(screen.getByLabelText("搜索表情"))).toBe(true);
    expect(fireEvent.mouseDown(screen.getByRole("tab", { name: "最近" }))).toBe(false);
    expect(fireEvent.mouseDown(screen.getByRole("option", { name: "抱抱" }))).toBe(false);
  });

  it("搜索框吞掉普通按键、放行功能键，且自身输入不受影响", () => {
    // 挂在 Radix 下拉菜单里时，键盘事件会先给菜单的输入查找处理：普通字符必须
    // 被搜索框拦下（本组件用 stopPropagation 只影响 React 合成事件），
    // Tab/Esc/Enter 则原样放行，交给宿主管理焦点与关闭。
    render(<EmojiPicker onPick={vi.fn()} />);
    const search = screen.getByLabelText("搜索表情");

    const keys = ["a", "Tab", "Escape", "Enter"];
    for (const key of keys) {
      const handler = vi.fn();
      search.addEventListener("keydown", handler);
      fireEvent.keyDown(search, { key });
      search.removeEventListener("keydown", handler);
      expect(handler).toHaveBeenCalledTimes(1);
      // 无论是否被拦截，输入框本身都不能因为按键而被清空或失焦。
      expect(search).toHaveValue("");
    }

    // 拦截按键不能顺带破坏搜索本身。
    fireEvent.change(search, { target: { value: "hh" } });
    expect(screen.getByRole("option", { name: "抱抱" })).toBeInTheDocument();
    fireEvent.keyDown(search, { key: "Escape" });
    expect(search).toHaveValue("hh");
  });

  it("页签与表情项的 mousedown 都被阻止默认，避免编辑器丢选区", () => {
    const onPick = vi.fn();
    render(<EmojiPicker onPick={onPick} />);
    const tab = screen.getByRole("tab", { name: "符号" });
    expect(fireEvent.mouseDown(tab)).toBe(false);
    const option = screen.getByRole("option", { name: "抱抱" });
    expect(fireEvent.mouseDown(option)).toBe(false);
  });

  it("自定义表情图片加载失败时降级为 fallback 文本", () => {
    const { container } = render(<EmojiPicker onPick={vi.fn()} />);
    const image = container.querySelector("img") as HTMLImageElement;
    expect(image.getAttribute("src")).toBe("/api/emoji/hug/image?frame=first");
    fireEvent.error(image);
    expect(screen.getByRole("img", { name: "抱抱" })).toHaveTextContent("🤗");
  });

  it("初始分组可指定，用于宿主按场景引导", () => {
    render(<EmojiPicker onPick={vi.fn()} initialGroupId="gestures" />);
    expect(screen.getByRole("option", { name: "赞" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "抱抱" })).toBeNull();
  });
});
