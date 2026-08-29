import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ColorPicker,
  ColorPickerPopover,
  hexToHsv,
  hsvToHex,
  isValidHexInput,
  normalizeHex,
  splitAlpha,
  withAlpha,
} from "./color-picker";

describe("颜色工具函数", () => {
  it("normalizeHex 归一化短 hex、rgb、rgba 并回退默认色", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("#a1b2c3")).toBe("#a1b2c3");
    expect(normalizeHex("#FF00FF80")).toBe("#ff00ff80");
    expect(normalizeHex("rgb(1, 20, 255)")).toBe("#0114ff");
    expect(normalizeHex("rgba(1, 20, 255, 0.5)")).toBe("#0114ff80");
    expect(normalizeHex("rgba(1, 20, 255, 50%)")).toBe("#0114ff80");
    expect(normalizeHex("red")).toBe("#20272c");
    expect(normalizeHex("")).toBe("#20272c");
  });

  it("hex ↔ HSV 往返一致", () => {
    for (const hex of ["#000000", "#ffffff", "#4f46e5", "#197c73", "#ff0000"]) {
      const { h, s, v } = hexToHsv(hex);
      expect(hsvToHex(h, s, v)).toBe(hex);
    }
    expect(hexToHsv("#4f46e5").s).toBeGreaterThan(0.5);
    expect(hexToHsv("#4f46e5").v).toBeGreaterThan(0.7);
    expect(hexToHsv("#000000").v).toBe(0);
  });

  it("splitAlpha / withAlpha 正确处理 8 位 hex", () => {
    expect(splitAlpha("#4f46e5")).toEqual({ hex6: "#4f46e5", alpha: 1 });
    expect(splitAlpha("#4f46e580")).toEqual({
      hex6: "#4f46e5",
      alpha: 0x80 / 255,
    });
    expect(withAlpha("#4f46e5", 1)).toBe("#4f46e5");
    expect(withAlpha("#4f46e5", 0.5)).toBe("#4f46e580");
    expect(withAlpha("#4f46e5", 0)).toBe("#4f46e500");
  });

  it("isValidHexInput 校验 3/6/8 位输入", () => {
    expect(isValidHexInput("#abc")).toBe(true);
    expect(isValidHexInput("aabbcc")).toBe(true);
    expect(isValidHexInput("aabbccdd")).toBe(true);
    expect(isValidHexInput("aabbc")).toBe(false);
    expect(isValidHexInput("zzz")).toBe(false);
  });
});

describe("ColorPicker 组件", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("完整模式渲染 SV 面板、色相/透明度滑杆（Radix）、Hex 输入与已存颜色", () => {
    render(<ColorPicker value="#4f46e5" onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: "饱和度与亮度" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "色相" })).toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "透明度" })).toBeInTheDocument();
    expect(screen.getByLabelText("Hex 色值")).toHaveValue("#4f46e5");
    expect(screen.getByLabelText("已存颜色色板")).toBeInTheDocument();
    expect(screen.getByLabelText("文字颜色 #197c73")).toBeInTheDocument();
    expect(screen.getByLabelText("添加当前颜色")).toBeInTheDocument();
    // 调色区不直接应用，也没有独立的「应用到文字」按钮
    expect(screen.queryByRole("button", { name: "应用到文字" })).not.toBeInTheDocument();
  });

  it("调色区（滑杆/SV/Hex）只更新草稿并同步 onDraftChange，不触发 onChange", () => {
    const onChange = vi.fn();
    const onDraftChange = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 236, 144),
    );
    render(
      <ColorPicker value="#ff0000" onChange={onChange} onDraftChange={onDraftChange} />,
    );
    // 色相滑杆键盘调整（草稿）
    fireEvent.keyDown(screen.getByRole("slider", { name: "色相" }), {
      key: "ArrowRight",
    });
    // SV 面板点击（草稿）
    fireEvent.pointerDown(screen.getByRole("slider", { name: "饱和度与亮度" }), {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 236,
      clientY: 0,
    });
    // Hex 输入回车（草稿）
    const input = screen.getByLabelText("Hex 色值");
    fireEvent.change(input, { target: { value: "#4F46E5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).not.toHaveBeenCalled();
    expect(onDraftChange).toHaveBeenLastCalledWith("#4f46e5");
  });

  it("点击已存色块直接应用并持久化记忆色", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("文字颜色 #197c73"));
    expect(onChange).toHaveBeenLastCalledWith("#197c73");
    expect(window.localStorage.getItem("ricetext:last-color")).toBe("#197c73");
  });

  it("showSaturation=false 隐藏 SV 面板（子菜单紧凑场景）", () => {
    render(<ColorPicker value="#000000" onChange={vi.fn()} showSaturation={false} />);
    expect(
      screen.queryByRole("slider", { name: "饱和度与亮度" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "色相" })).toBeInTheDocument();
    expect(screen.getByLabelText("Hex 色值")).toBeInTheDocument();
  });

  it("无 value 时以记忆色为初始草稿（默认 #20272c）", () => {
    render(<ColorPicker onChange={vi.fn()} />);
    expect(screen.getByLabelText("Hex 色值")).toHaveValue("#20272c");
  });

  it("Hex 非法值失焦回退", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    const input = screen.getByLabelText("Hex 色值");
    fireEvent.change(input, { target: { value: "zzz" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("#000000");
  });

  it("添加当前颜色写入已存色板并持久化到 localStorage", () => {
    render(<ColorPicker value="#123456" onChange={vi.fn()} />);
    fireEvent.click(screen.getByLabelText("添加当前颜色"));
    expect(screen.getByLabelText("文字颜色 #123456")).toBeInTheDocument();
    const stored = JSON.parse(
      window.localStorage.getItem("ricetext:saved-colors") ?? "[]",
    ) as string[];
    expect(stored).toContain("#123456");
  });

  it("direct 模式（无触发按钮内联）下调色即直接应用", () => {
    const onChange = vi.fn();
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 236, 144),
    );
    render(<ColorPicker value="#000000" onChange={onChange} direct />);
    // Hex 回车直接应用
    const input = screen.getByLabelText("Hex 色值");
    fireEvent.change(input, { target: { value: "#4F46E5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("#4f46e5");
    // 透明度滑杆点击直接应用
    const sliderRoot = screen.getByRole("slider", { name: "透明度" });
    fireEvent.keyDown(sliderRoot, { key: "ArrowLeft" });
    expect(onChange).toHaveBeenCalled();
  });

  it("Popover 包装器：色块按钮直接应用，箭头按钮打开面板，色块跟随草稿", () => {
    const onChange = vi.fn();
    render(<ColorPickerPopover onChange={onChange} />);
    const swatchButton = screen.getByRole("button", { name: "应用文字颜色" });
    const arrowButton = screen.getByRole("button", { name: "文字颜色" });
    expect(arrowButton.querySelector("svg[class*=chevron]")).not.toBeNull();

    // 1. 色块按钮点击：直接应用当前色（不打开面板）
    fireEvent.click(swatchButton);
    expect(onChange).toHaveBeenLastCalledWith("#20272c");
    expect(screen.queryByLabelText("拾色器")).not.toBeInTheDocument();

    // 2. 箭头按钮点击：打开面板
    fireEvent.click(arrowButton);
    expect(screen.getByLabelText("拾色器")).toBeInTheDocument();

    // 3. 面板内已存色块 → 应用 + 记忆 + 关闭
    fireEvent.click(screen.getByLabelText("文字颜色 #197c73"));
    expect(onChange).toHaveBeenLastCalledWith("#197c73");
    expect(screen.queryByLabelText("拾色器")).not.toBeInTheDocument();
    expect(window.localStorage.getItem("ricetext:last-color")).toBe("#197c73");

    // 4. 色块按钮显示应用后的颜色（#197c73）
    const swatch = swatchButton.querySelector("span");
    expect(swatch).not.toBeNull();
    expect(swatch?.getAttribute("style")).toMatch(/197c73|25, ?124, ?115/);

    // 5. 面板调色（Hex 草稿）→ 色块实时跟随
    fireEvent.click(arrowButton);
    const hex = screen.getByLabelText("Hex 色值");
    fireEvent.change(hex, { target: { value: "#4F46E5" } });
    fireEvent.keyDown(hex, { key: "Enter" });
    const swatchAfter = swatchButton.querySelector("span");
    expect(swatchAfter?.getAttribute("style")).toMatch(/4f46e5|79, ?70, ?229/);
    // 草稿不应用
    expect(onChange).toHaveBeenCalledTimes(2);
  });
});
