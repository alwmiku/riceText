import { useMemo, useState } from "react";
import type { AppContextValue } from "../app-context";
import { identities } from "../lib/seed";
import type { SeedIdentity } from "../lib/types";

const identityStorageKey = "ricetext:identity";

function getStoredIdentity(): SeedIdentity {
  const stored = localStorage.getItem(identityStorageKey);
  return identities.find((item) => item.id === stored) ?? identities[0]!;
}

/** 恢复、切换并持久化演示身份。 */
export function useDemoIdentity(): AppContextValue {
  const [identity, setIdentityState] = useState(getStoredIdentity);

  // Context value 保持引用稳定，避免身份未变化时让所有页面无意义重渲染。
  return useMemo(
    () => ({
      identity,
      setIdentity(next: SeedIdentity) {
        setIdentityState(next);
        localStorage.setItem(identityStorageKey, next.id);
      },
    }),
    [identity],
  );
}
