import { createContext, useContext } from 'react';
import type { SeedIdentity } from './lib/types';

/** 全局论坛身份及其切换入口；生产环境可替换为真实会话 Provider。 */
export interface AppContextValue {
  /** 当前用于权限、金币和投票的身份。 */
  identity: SeedIdentity;
  /** 切换身份并由 App 持久化选择。 */
  setIdentity: (identity: SeedIdentity) => void;
}

/** 页面级身份上下文；默认 null 用来检测遗漏 Provider 的集成错误。 */
export const AppContext = createContext<AppContextValue | null>(null);

/** 读取当前身份，并在 Provider 缺失时尽早抛出明确错误。 */
export function useAppContext(): AppContextValue {
  const value = useContext(AppContext);
  if (!value) throw new Error('useAppContext 必须在 AppContext.Provider 内使用');
  return value;
}
