import type { ForumSessionUser } from "@ricetext/contracts";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { AppContextValue } from "../app-context";
import { isApiClientError } from "../lib/api/client";
import {
  beginForumLogin,
  getForumSession,
  logoutForumSession,
} from "../lib/api/session";
import { identities } from "../lib/seed";
import type { SeedIdentity } from "../lib/types";

const identityStorageKey = "ricetext:identity";
const anonymousIdentity: SeedIdentity = {
  id: "anonymous",
  name: "未登录",
  role: "reader",
  avatar: "访",
  coins: 0,
  replied: false,
};

export function isDemoAuthEnabled(): boolean {
  return import.meta.env.DEV || import.meta.env.VITE_DEMO_AUTH === "true";
}

function getStoredIdentity(): SeedIdentity {
  const stored = localStorage.getItem(identityStorageKey);
  return identities.find((item) => item.id === stored) ?? identities[0]!;
}

export function mapSessionIdentity(user: ForumSessionUser): SeedIdentity {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    avatar: user.avatar,
    coins: user.coins,
    replied: user.replied,
  };
}

/** Use local switchable identities in development and an HttpOnly server session in production. */
export function useForumIdentity(): AppContextValue {
  const demo = isDemoAuthEnabled();
  const [identity, setIdentityState] = useState<SeedIdentity>(() =>
    demo ? getStoredIdentity() : anonymousIdentity,
  );
  const [authStatus, setAuthStatus] = useState<AppContextValue["authStatus"]>(
    demo ? "authenticated" : "loading",
  );

  const refreshIdentity = useCallback(async () => {
    if (demo) return;
    try {
      const session = await getForumSession();
      setIdentityState(mapSessionIdentity(session.current));
      setAuthStatus("authenticated");
    } catch (error) {
      setIdentityState(anonymousIdentity);
      setAuthStatus(isApiClientError(error) && error.status === 401 ? "unauthenticated" : "error");
    }
  }, [demo]);

  useEffect(() => {
    void refreshIdentity();
  }, [refreshIdentity]);

  const logout = useCallback(async () => {
    if (demo) return;
    try {
      await logoutForumSession();
    } finally {
      setIdentityState(anonymousIdentity);
      setAuthStatus("unauthenticated");
    }
  }, [demo]);

  return useMemo(
    () => ({
      identity,
      authMode: demo ? "demo" : "session",
      authStatus,
      setIdentity(next: SeedIdentity) {
        if (!demo) return;
        setIdentityState(next);
        localStorage.setItem(identityStorageKey, next.id);
      },
      login() {
        if (!demo) beginForumLogin();
      },
      logout,
      refreshIdentity,
    }),
    [authStatus, demo, identity, logout, refreshIdentity],
  );
}
