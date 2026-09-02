// 验证 demo 身份切换与生产 OIDC 会话采用不同状态来源，避免请求头身份泄漏到生产。
import { ApiClientError } from "@ricetext/contracts";
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useForumIdentity } from "./useForumIdentity";

const mocks = vi.hoisted(() => ({
  getForumSession: vi.fn(),
  loginForumSession: vi.fn(),
  logoutForumSession: vi.fn(),
}));

vi.mock("../lib/api/session", () => mocks);

describe("useForumIdentity production session", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", false);
    vi.stubEnv("VITE_DEMO_AUTH", "false");
    mocks.getForumSession.mockReset();
    mocks.loginForumSession.mockReset().mockResolvedValue(undefined);
    mocks.logoutForumSession.mockReset().mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("loads the server session and exposes login/logout actions", async () => {
    mocks.getForumSession.mockResolvedValue({
      current: {
        id: "oidc-user",
        name: "云端读者",
        role: "reader",
        isFriend: false,
        bio: "",
        avatar: "云",
        coins: 42,
        replied: true,
      },
      available: [],
    });
    const { result } = renderHook(() => useForumIdentity());
    expect(result.current.authMode).toBe("session");
    expect(result.current.authStatus).toBe("loading");
    await waitFor(() => expect(result.current.authStatus).toBe("authenticated"));
    expect(result.current.identity).toEqual({
      id: "oidc-user",
      name: "云端读者",
      role: "reader",
      avatar: "云",
      coins: 42,
      replied: true,
    });

    await act(() => result.current.login("writer", "correct-password"));
    expect(mocks.loginForumSession).toHaveBeenCalledWith("writer", "correct-password");
    await act(() => result.current.logout());
    expect(mocks.logoutForumSession).toHaveBeenCalledOnce();
    expect(result.current.authStatus).toBe("unauthenticated");
    expect(result.current.identity.role).toBe("reader");
    expect(result.current.identity.name).toBe("未登录");
  });

  it("does not fall back to a local author after a 401", async () => {
    mocks.getForumSession.mockRejectedValue(
      new ApiClientError(401, "AUTH_REQUIRED", "请先登录"),
    );
    const { result } = renderHook(() => useForumIdentity());
    await waitFor(() => expect(result.current.authStatus).toBe("unauthenticated"));
    expect(result.current.identity).toMatchObject({
      id: "anonymous",
      role: "reader",
      coins: 0,
    });
  });
});
