import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SaveStatus } from "./SaveStatus";

describe("SaveStatus", () => {
  it("明确显示当前章节版本，避免与文档修订号混淆", () => {
    render(<SaveStatus state="saved" revision={1} savedAt="2025-09-16T15:30:00.000Z" />);

    expect(screen.getByText("已保存到服务器 · 章节 v1")).toBeInTheDocument();
  });
});
