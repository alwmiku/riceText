import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PollResultChart, type PollResultChartOption } from "./poll-result-chart";

const option = (
  id: string,
  overrides: Partial<PollResultChartOption> = {},
): PollResultChartOption => ({
  id,
  label: id,
  votes: 10,
  selected: false,
  disabled: false,
  multiple: false,
  ...overrides,
});

/** 图表列的 aria-label 里带票数与占比，便于断言渲染结果。 */
const column = (label: string, votes: number, percent: number) =>
  screen.getByRole("button", { name: `${label} ${votes} 票, ${percent}%` });

describe("PollResultChart", () => {
  it("单选：点击列在选中与取消之间切换，并回调最新选择", () => {
    const onSelectionChange = vi.fn();
    render(
      <PollResultChart
        options={[option("a"), option("b")]}
        voteLabel="票"
        onSelectionChange={onSelectionChange}
      />,
    );

    expect(column("a", 10, 50)).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(column("a", 10, 50));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["a"]);
    expect(column("a", 10, 50)).toHaveAttribute("aria-pressed", "true");

    // 单选换选项：只保留最后点击的一个。
    fireEvent.click(column("b", 10, 50));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["b"]);
    expect(column("a", 10, 50)).toHaveAttribute("aria-pressed", "false");

    // 再次点击同一列取消选择。
    fireEvent.click(column("b", 10, 50));
    expect(onSelectionChange).toHaveBeenLastCalledWith([]);
  });

  it("多选：累加与移除选项", () => {
    const onSelectionChange = vi.fn();
    render(
      <PollResultChart
        options={[option("a", { multiple: true }), option("b", { multiple: true })]}
        voteLabel="票"
        onSelectionChange={onSelectionChange}
      />,
    );

    fireEvent.click(column("a", 10, 50));
    fireEvent.click(column("b", 10, 50));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["a", "b"]);
    fireEvent.click(column("a", 10, 50));
    expect(onSelectionChange).toHaveBeenLastCalledWith(["b"]);
    // 多选时渲染复选框图例。
    expect(screen.getAllByRole("checkbox")).toHaveLength(2);
  });

  it("图例与图表列共享同一份待提交选择", () => {
    const onSelectionChange = vi.fn();
    render(
      <PollResultChart
        options={[option("a"), option("b")]}
        voteLabel="票"
        onSelectionChange={onSelectionChange}
      />,
    );
    fireEvent.click(screen.getAllByRole("radio")[0]!);
    expect(onSelectionChange).toHaveBeenLastCalledWith(["a"]);
    expect(column("a", 10, 50)).toHaveAttribute("aria-pressed", "true");
  });

  it("提交优先走 onSubmit，缺省时逐个回调 onVote", () => {
    const onSubmit = vi.fn();
    const onVote = vi.fn();
    const { unmount } = render(
      <PollResultChart
        options={[option("a"), option("b")]}
        voteLabel="票"
        onSubmit={onSubmit}
        onVote={onVote}
      />,
    );
    const submit = screen.getByRole("button", { name: "投票" });
    expect(submit).toBeDisabled();
    fireEvent.click(column("a", 10, 50));
    expect(submit).toBeEnabled();
    fireEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(["a"]);
    expect(onVote).not.toHaveBeenCalled();
    unmount();

    render(<PollResultChart options={[option("a")]} voteLabel="票" onVote={onVote} />);
    fireEvent.click(column("a", 10, 100));
    fireEvent.click(screen.getByRole("button", { name: "投票" }));
    expect(onVote).toHaveBeenCalledWith("a");
  });

  it("已投票：列按服务端结果高亮、按钮禁用且提交不可用", () => {
    render(
      <PollResultChart
        options={[option("a", { selected: true }), option("b")]}
        voteLabel="票"
        voted
        onVote={vi.fn()}
      />,
    );
    expect(column("a", 10, 50)).toBeDisabled();
    expect(column("a", 10, 50)).toHaveAttribute("aria-pressed", "true");
    expect(column("b", 10, 50)).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByRole("button", { name: "已投票" })).toBeDisabled();
    // 已投票时不再显示可交互图例。
    expect(screen.queryByRole("radio")).toBeNull();
  });

  it("全部选项被禁用或零票时提交保持禁用、占比按 0 处理", () => {
    render(
      <PollResultChart
        options={[
          option("a", { disabled: true, votes: 0, selected: true }),
          option("b", { disabled: true, votes: 0 }),
        ]}
        voteLabel="票"
        height={60}
        showGrid
        groupName="poll-1"
      />,
    );
    expect(column("a", 0, 0)).toBeDisabled();
    expect(screen.getByRole("button", { name: "投票" })).toBeDisabled();
  });
});
