import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AttachmentDialog,
  DiceDialog,
  ExcerptDialog,
  ImageDialog,
  LinkDialog,
  MentionDialog,
  PollDialog,
} from "./dialogs";

const { createDiceMock, uploadAssetMock } = vi.hoisted(() => ({
  createDiceMock: vi.fn(),
  uploadAssetMock: vi.fn(),
}));

vi.mock("../../lib/api", () => ({
  createDice: createDiceMock,
  uploadAsset: uploadAssetMock,
}));

describe("editor dialogs", () => {
  beforeEach(() => {
    createDiceMock.mockReset();
    uploadAssetMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("创建骰子后插入并关闭对话框", async () => {
    const result = {
      rollId: "roll_1",
      expression: "1d20+2",
      rolls: [18],
      total: 20,
      rerollOf: null,
    };
    createDiceMock.mockResolvedValueOnce(result);
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(<DiceDialog open onOpenChange={onOpenChange} onInsert={onInsert} />);

    fireEvent.change(screen.getByLabelText("骰子表达式"), {
      target: { value: "1d20+2" },
    });
    fireEvent.click(screen.getByRole("button", { name: "投掷并插入" }));

    await waitFor(() => expect(onInsert).toHaveBeenCalledWith(result));
    expect(createDiceMock).toHaveBeenCalledWith("1d20+2");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("骰子失败时保留对话框并显示错误", async () => {
    createDiceMock.mockRejectedValueOnce(new Error("表达式无效"));
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(<DiceDialog open onOpenChange={onOpenChange} onInsert={onInsert} />);

    fireEvent.click(screen.getByRole("button", { name: "投掷并插入" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("表达式无效");
    expect(onInsert).not.toHaveBeenCalled();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("校验外链图片并提交排版属性", () => {
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ImageDialog open onOpenChange={onOpenChange} onInsert={onInsert} />,
    );
    const insert = screen.getByRole("button", { name: "插入图片" });
    expect(insert).toBeDisabled();

    fireEvent.change(screen.getByLabelText("图片地址"), {
      target: { value: "ftp://invalid/image.png" },
    });
    expect(insert).toBeDisabled();
    fireEvent.change(screen.getByLabelText("图片地址"), {
      target: { value: "https://img.example/cover.png" },
    });
    fireEvent.change(screen.getByLabelText("替代文字"), {
      target: { value: "封面" },
    });
    fireEvent.change(screen.getByLabelText("图片说明"), {
      target: { value: "第一版封面" },
    });
    fireEvent.change(screen.getByLabelText("对齐"), {
      target: { value: "right" },
    });
    fireEvent.change(screen.getByRole("slider"), { target: { value: "65" } });
    expect(screen.getByAltText("图片预览")).toHaveAttribute(
      "src",
      "https://img.example/cover.png",
    );

    fireEvent.click(insert);
    expect(onInsert).toHaveBeenCalledWith(null, {
      src: "https://img.example/cover.png",
      alt: "封面",
      caption: "第一版封面",
      align: "right",
      width: 65,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("上传图片后自动填写地址和替代文字", async () => {
    const uploaded = {
      assetId: "asset_1",
      url: "/uploads/chapter.webp",
      name: "chapter.webp",
      mimeType: "image/webp",
      size: 4,
    };
    uploadAssetMock.mockResolvedValueOnce(uploaded);
    const onInsert = vi.fn();
    render(<ImageDialog open onOpenChange={vi.fn()} onInsert={onInsert} />);
    const file = new File(["data"], "chapter.webp", { type: "image/webp" });

    fireEvent.change(document.querySelector('input[type="file"]')!, {
      target: { files: [file] },
    });

    await waitFor(() => expect(uploadAssetMock).toHaveBeenCalledWith(file));
    expect(screen.getByLabelText("图片地址")).toHaveValue(
      "/uploads/chapter.webp",
    );
    expect(screen.getByLabelText("替代文字")).toHaveValue("chapter");
    fireEvent.click(screen.getByRole("button", { name: "插入图片" }));
    expect(onInsert).toHaveBeenCalledWith(
      uploaded,
      expect.objectContaining({ src: "/uploads/chapter.webp", alt: "chapter" }),
    );
  });

  it("摘录必须有正文，并提交作品来源和排版", () => {
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <ExcerptDialog open onOpenChange={onOpenChange} onInsert={onInsert} />,
    );
    const insert = screen.getByRole("button", { name: "插入摘录" });
    expect(insert).toBeDisabled();

    fireEvent.change(screen.getByLabelText("书名"), {
      target: { value: "纸上潮汐" },
    });
    fireEvent.change(screen.getByLabelText("章节"), {
      target: { value: "第五章" },
    });
    fireEvent.change(screen.getByLabelText("作者"), {
      target: { value: "青禾" },
    });
    fireEvent.change(screen.getByLabelText("排版"), {
      target: { value: "mobile-book" },
    });
    fireEvent.change(screen.getByLabelText("来源链接（可选）"), {
      target: { value: "https://books.example/5" },
    });
    fireEvent.change(screen.getByLabelText("摘录正文"), {
      target: { value: "潮水漫过了石阶。" },
    });
    fireEvent.click(insert);

    expect(onInsert).toHaveBeenCalledWith({
      bookTitle: "纸上潮汐",
      chapterTitle: "第五章",
      author: "青禾",
      sourceUrl: "https://books.example/5",
      variant: "mobile-book",
      text: "潮水漫过了石阶。",
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("创建投票时可添加选项并提交多选设置", () => {
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(<PollDialog open onOpenChange={onOpenChange} onInsert={onInsert} />);

    const submit = screen.getByRole("button", { name: "插入投票" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("投票问题"), {
      target: { value: "下一章先去哪里？" },
    });
    fireEvent.change(screen.getByLabelText("投票选项 1"), {
      target: { value: "钟楼" },
    });
    fireEvent.change(screen.getByLabelText("投票选项 2"), {
      target: { value: "旧码头" },
    });
    fireEvent.click(screen.getByLabelText("允许多选"));
    fireEvent.click(screen.getByRole("button", { name: "添加选项" }));
    fireEvent.change(screen.getByLabelText("投票选项 3"), {
      target: { value: "潮汐图书馆" },
    });
    fireEvent.click(submit);

    expect(onInsert).toHaveBeenCalledWith({
      question: "下一章先去哪里？",
      multiple: true,
      options: [
        expect.objectContaining({ label: "钟楼" }),
        expect.objectContaining({ label: "旧码头" }),
        expect.objectContaining({ label: "潮汐图书馆" }),
      ],
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("编辑附件时预填字段，并规范化提交值", () => {
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AttachmentDialog
        open
        initial={{
          name: "旧附件.zip",
          mimeType: "application/zip",
          size: 10,
          priceCoins: 2,
        }}
        onOpenChange={onOpenChange}
        onInsert={onInsert}
      />,
    );
    expect(screen.getByRole("dialog", { name: "编辑附件" })).toBeInTheDocument();
    expect(screen.getByLabelText("文件名")).toHaveValue("旧附件.zip");

    fireEvent.change(screen.getByLabelText("文件名"), {
      target: { value: "  新附件.zip  " },
    });
    fireEvent.change(screen.getByLabelText("MIME 类型"), {
      target: { value: "  " },
    });
    fireEvent.change(screen.getByLabelText("大小（字节）"), {
      target: { value: "10.6" },
    });
    fireEvent.change(screen.getByLabelText("价格（金币）"), {
      target: { value: "2.6" },
    });
    fireEvent.click(screen.getByRole("button", { name: "保存修改" }));

    expect(onInsert).toHaveBeenCalledWith({
      name: "新附件.zip",
      mimeType: "application/octet-stream",
      size: 11,
      priceCoins: 3,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("附件字段无效时禁止提交，取消时直接关闭", () => {
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <AttachmentDialog open onOpenChange={onOpenChange} onInsert={onInsert} />,
    );
    const submit = screen.getByRole("button", { name: "插入附件" });
    expect(submit).toBeDisabled();

    fireEvent.change(screen.getByLabelText("文件名"), {
      target: { value: "资料.zip" },
    });
    fireEvent.change(screen.getByLabelText("大小（字节）"), {
      target: { value: "-1" },
    });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("大小（字节）"), {
      target: { value: "0" },
    });
    fireEvent.change(screen.getByLabelText("价格（金币）"), {
      target: { value: "-1" },
    });
    expect(submit).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "取消" }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(onInsert).not.toHaveBeenCalled();
  });

  it("提及搜索区分好友与等待服务器解析的用户", async () => {
    vi.useFakeTimers();
    const onInsert = vi.fn();
    const onOpenChange = vi.fn();
    const first = render(
      <MentionDialog open onOpenChange={onOpenChange} onInsert={onInsert} />,
    );

    fireEvent.change(screen.getByPlaceholderText("按名字或 ID 搜索"), {
      target: { value: "晚风" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    fireEvent.click(screen.getByRole("button", { name: /晚风翻页/ }));
    expect(onInsert).toHaveBeenCalledWith({
      id: "user_reader",
      name: "晚风翻页",
      resolved: true,
      avatarUrl: null,
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);

    first.unmount();
    onInsert.mockClear();
    render(
      <MentionDialog open onOpenChange={onOpenChange} onInsert={onInsert} />,
    );
    fireEvent.change(screen.getByPlaceholderText("按名字或 ID 搜索"), {
      target: { value: "陌生读者42" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(260);
    });
    fireEvent.click(screen.getByRole("button", { name: /@陌生读者42/ }));
    expect(onInsert).toHaveBeenCalledWith({
      id: "陌生读者42",
      name: "陌生读者42",
      resolved: false,
      avatarUrl: null,
    });
  });

  describe("LinkDialog", () => {
    it("默认填入 https:// 前缀并校验非法地址", () => {
      const onInsert = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <LinkDialog open onOpenChange={onOpenChange} onInsert={onInsert} />,
      );
      const input = screen.getByLabelText("链接地址");
      expect(input).toHaveValue("https://");

      fireEvent.change(input, { target: { value: "javascript:alert(1)" } });
      expect(screen.getByRole("alert")).toHaveTextContent(
        "仅允许 HTTP(S) 链接",
      );
      expect(
        screen.getByRole("button", { name: "插入链接" }),
      ).toBeDisabled();
      fireEvent.click(screen.getByRole("button", { name: "插入链接" }));
      expect(onInsert).not.toHaveBeenCalled();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });

    it("合法地址提交裁剪后的文本并关闭", () => {
      const onInsert = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <LinkDialog open onOpenChange={onOpenChange} onInsert={onInsert} />,
      );
      fireEvent.change(screen.getByLabelText("链接地址"), {
        target: { value: "  https://example.com/a  " },
      });
      fireEvent.keyDown(screen.getByLabelText("链接地址"), {
        key: "Enter",
      });
      expect(onInsert).toHaveBeenCalledWith("https://example.com/a");
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    it("初始地址回填并支持移除既有链接", () => {
      const onInsert = vi.fn();
      const onRemove = vi.fn();
      const onOpenChange = vi.fn();
      render(
        <LinkDialog
          open
          onOpenChange={onOpenChange}
          onInsert={onInsert}
          initialHref="https://old.example.com"
          onRemove={onRemove}
        />,
      );
      expect(screen.getByLabelText("链接地址")).toHaveValue(
        "https://old.example.com",
      );
      expect(screen.getByRole("button", { name: "保存修改" })).toBeEnabled();
      fireEvent.click(screen.getByRole("button", { name: "移除链接" }));
      expect(onRemove).toHaveBeenCalledTimes(1);
      expect(onOpenChange).toHaveBeenCalledWith(false);
      expect(onInsert).not.toHaveBeenCalled();
    });
  });
});
