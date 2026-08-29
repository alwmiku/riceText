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
  });

  it("拖动色相滑杆（Radix Slider）实时产出颜色", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#ff0000" onChange={onChange} />);
    const hue = screen.getByRole("slider", { name: "色相" });
    // Radix Slider 的轨道点击会按位置更新值（jsdom 中直接触发键盘更稳定）
    fireEvent.keyDown(hue, { key: "ArrowRight" });
    expect(onChange).toHaveBeenCalled();
  });

  it("SV 面板按下即选色（点击取色）", () => {
    const onChange = vi.fn();
    // jsdom 的 getBoundingClientRect 全为 0，模拟面板尺寸让坐标换算生效。
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
      new DOMRect(0, 0, 236, 144),
    );
    render(<ColorPicker value="#ff0000" onChange={onChange} />);
    const sv = screen.getByRole("slider", { name: "饱和度与亮度" });
    fireEvent.pointerDown(sv, {
      pointerId: 1,
      pointerType: "mouse",
      button: 0,
      clientX: 236,
      clientY: 0,
    });
    expect(onChange).toHaveBeenLastCalledWith("#ff0000");
  });

  it("点击已存色块输出归一化 hex", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("文字颜色 #197c73"));
    expect(onChange).toHaveBeenLastCalledWith("#197c73");
  });

  it("Hex 输入框回车提交合法值，非法值失焦回退", () => {
    const onChange = vi.fn();
    render(<ColorPicker value="#000000" onChange={onChange} />);
    const input = screen.getByLabelText("Hex 色值");
    fireEvent.change(input, { target: { value: "#4F46E5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenLastCalledWith("#4f46e5");
    fireEvent.change(input, { target: { value: "zzz" } });
    fireEvent.blur(input);
    expect(input).toHaveValue("#4f46e5");
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

  it("紧凑模式省略 SV 面板与色相滑杆，保留透明度与系统取色器", () => {
    render(<ColorPicker value="#000000" onChange={vi.fn()} compact />);
    expect(
      screen.queryByRole("slider", { name: "饱和度与亮度" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("slider", { name: "色相" })).not.toBeInTheDocument();
    expect(screen.getByRole("slider", { name: "透明度" })).toBeInTheDocument();
    expect(screen.getByLabelText("系统取色器")).toBeInTheDocument();
    expect(screen.getByLabelText("文字颜色 #197c73")).toBeInTheDocument();
    expect(screen.queryByLabelText("色板")).not.toBeInTheDocument();
  });

  it("Popover 包装器点击触发按钮打开拾色器", () => {
    render(<ColorPickerPopover value="#000000" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "文字颜色" }));
    expect(screen.getByLabelText("拾色器")).toBeInTheDocument();
  });
});
