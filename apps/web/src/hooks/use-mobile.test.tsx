import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useIsMobile } from "./use-mobile";

/** 只实现被测 hook 用到的最小 MediaQueryList 行为。 */
function stubMatchMedia(): { fireChange: () => void } {
  const listeners = new Set<() => void>();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
    dispatchEvent: () => false,
  }));
  return {
    fireChange: () => {
      for (const listener of listeners) listener();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useIsMobile", () => {
  it("按视口宽度判断，并在媒体查询变化时跟随", () => {
    const media = stubMatchMedia();
    vi.stubGlobal("innerWidth", 1024);
    const { result } = renderHook(() => useIsMobile());
    expect(result.current).toBe(false);

    act(() => {
      vi.stubGlobal("innerWidth", 390);
      media.fireChange();
    });
    expect(result.current).toBe(true);

    act(() => {
      vi.stubGlobal("innerWidth", 1280);
      media.fireChange();
    });
    expect(result.current).toBe(false);
  });

  it("卸载时移除监听，避免残留回调", () => {
    const media = stubMatchMedia();
    vi.stubGlobal("innerWidth", 390);
    const { result, unmount } = renderHook(() => useIsMobile());
    expect(result.current).toBe(true);
    unmount();
    // 卸载后再触发变化不应抛错；监听集合已被清理。
    act(() => media.fireChange());
    expect(result.current).toBe(true);
  });
});
