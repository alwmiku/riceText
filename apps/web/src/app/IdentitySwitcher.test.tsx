// 生产登录弹窗只把凭据提交给会话接口，不在浏览器持久化密码。
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppContext, type AppContextValue } from "../app-context";
import { IdentitySwitcher } from "./IdentitySwitcher";

const anonymous = {
  id: "anonymous",
  name: "未登录",
  role: "reader" as const,
  avatar: "访",
  coins: 0,
  replied: false,
};

describe("IdentitySwitcher password login", () => {
  it("opens the credential form and submits username and password", async () => {
    const login = vi.fn().mockResolvedValue(undefined);
    const value: AppContextValue = {
      identity: anonymous,
      authMode: "session",
      authStatus: "unauthenticated",
      setIdentity: vi.fn(),
      login,
      logout: vi.fn().mockResolvedValue(undefined),
      refreshIdentity: vi.fn().mockResolvedValue(undefined),
    };
    render(
      <AppContext.Provider value={value}>
        <IdentitySwitcher />
      </AppContext.Provider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    fireEvent.change(screen.getByLabelText("账号"), { target: { value: "writer" } });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "correct-password" },
    });
    const dialog = screen.getByRole("dialog", { name: "登录 RiceText" });
    fireEvent.submit(within(dialog).getByRole("button", { name: "登录" }).closest("form")!);

    await waitFor(() =>
      expect(login).toHaveBeenCalledWith("writer", "correct-password"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog", { name: "登录 RiceText" })).not.toBeInTheDocument(),
    );
  });

  it("keeps the dialog open and reports rejected credentials", async () => {
    const value: AppContextValue = {
      identity: anonymous,
      authMode: "session",
      authStatus: "unauthenticated",
      setIdentity: vi.fn(),
      login: vi.fn().mockRejectedValue(new Error("账号或密码错误")),
      logout: vi.fn().mockResolvedValue(undefined),
      refreshIdentity: vi.fn().mockResolvedValue(undefined),
    };
    render(
      <AppContext.Provider value={value}>
        <IdentitySwitcher />
      </AppContext.Provider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "登录" }));
    fireEvent.change(screen.getByLabelText("账号"), { target: { value: "writer" } });
    fireEvent.change(screen.getByLabelText("密码"), {
      target: { value: "wrong-password" },
    });
    const dialog = screen.getByRole("dialog", { name: "登录 RiceText" });
    fireEvent.submit(within(dialog).getByRole("button", { name: "登录" }).closest("form")!);
    expect(await screen.findByRole("alert")).toHaveTextContent("账号或密码错误");
    expect(screen.getByRole("dialog", { name: "登录 RiceText" })).toBeVisible();
  });
});
