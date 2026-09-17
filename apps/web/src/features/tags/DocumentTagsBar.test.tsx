import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DocumentTag, Tag } from "@ricetext/contracts";
import { DocumentTagsBar } from "./DocumentTagsBar";

const dictionary: Tag[] = [
  { id: "tag-serial", slug: "连载中", label: "连载中", description: "章节仍在更新", hidden: false },
  { id: "tag-fantasy", slug: "奇幻", label: "奇幻", description: "含超自然设定", hidden: false },
];

function tag(label: string, source: "server" | "author"): DocumentTag {
  return { slug: label, label, source, tagId: source === "server" ? "tag-" + label : null };
}

describe("DocumentTagsBar", () => {
  it("按来源区分芯片，删除时提交剩余标签", () => {
    const onChange = vi.fn();
    render(
      <DocumentTagsBar
        tags={[tag("连载中", "server"), tag("慢热", "author")]}
        candidates={dictionary}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("连载中")).toBeInTheDocument();
    // 来源不再用角标文字表达：服务器标签是彩色胶囊，作者标签不带颜色。
    expect(document.querySelector('[data-source="server"]')).not.toBeNull();
    expect(document.querySelector('[data-source="author"]')).not.toBeNull();
    expect(screen.getByText("整篇文章 · 2/5")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "移除标签 连载中" }));
    expect(onChange).toHaveBeenCalledWith(["慢热"]);
  });

  it("输入 # 时列出站点标签，Enter 选中高亮候选", () => {
    const onChange = vi.fn();
    render(<DocumentTagsBar tags={[]} candidates={dictionary} onChange={onChange} />);
    const input = screen.getByLabelText("输入新标签");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "#" } });
    expect(screen.getByRole("listbox", { name: "站点标签候选" })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["奇幻"]);
  });

  it("直接输入文本按作者标签提交，Esc 关闭候选", () => {
    const onChange = vi.fn();
    render(<DocumentTagsBar tags={[]} candidates={dictionary} onChange={onChange} />);
    const input = screen.getByLabelText("输入新标签");
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "慢热" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith(["慢热"]);
  });

  it("点击候选把站点标签加在末尾，重复标签不重复提交", () => {
    const onChange = vi.fn();
    render(
      <DocumentTagsBar tags={[tag("连载中", "server")]} candidates={dictionary} onChange={onChange} />,
    );
    const input = screen.getByLabelText("输入新标签");
    fireEvent.focus(input);
    fireEvent.click(screen.getByRole("button", { name: "浏览站点标签" }));
    fireEvent.click(screen.getByRole("option", { name: /奇幻/ }));
    expect(onChange).toHaveBeenCalledWith(["连载中", "奇幻"]);
  });

  it("达到 5 个上限后不再提供输入框", () => {
    const onChange = vi.fn();
    render(
      <DocumentTagsBar
        tags={["甲", "乙", "丙", "丁", "戊"].map((label) => tag(label, "author"))}
        candidates={dictionary}
        onChange={onChange}
      />,
    );
    expect(screen.getByText("已达 5 个上限，删除后可以再加")).toBeInTheDocument();
    expect(screen.queryByLabelText("输入新标签")).not.toBeInTheDocument();
  });

  it("非法文本给出提示且不提交", () => {
    const onChange = vi.fn();
    render(<DocumentTagsBar tags={[]} candidates={[]} onChange={onChange} />);
    const input = screen.getByLabelText("输入新标签");
    fireEvent.change(input, { target: { value: "###" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("alert")).toHaveTextContent("标签需 1-24 个字符");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("只读模式没有输入与删除入口", () => {
    render(
      <DocumentTagsBar
        tags={[tag("连载中", "server")]}
        candidates={dictionary}
        readOnly
        readOnlyHint="文章保存到服务器后就可以加标签"
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByLabelText("输入新标签")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "移除标签 连载中" })).not.toBeInTheDocument();
    expect(screen.getByText("文章保存到服务器后就可以加标签")).toBeInTheDocument();
  });
});
