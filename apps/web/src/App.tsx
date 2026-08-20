import { lazy, Suspense, useMemo, useState } from 'react';
import { ChevronDown, Edit3, Eye, LoaderCircle } from 'lucide-react';
import { BrowserRouter, NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { AppContext } from './app-context';
import { useAppContext } from './app-context';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui';
import { identities } from './lib/seed';

// 编辑器与阅读器分别懒加载，阅读路由不会静态引入 Tiptap 编辑工具栏。
const ComposePage = lazy(() => import('./pages/ComposePage'));
const ReadPage = lazy(() => import('./pages/ReadPage'));

/** 顶部导航与演示身份切换器。 */
function AppHeader() {
  const value = useAppContext();
  return <header className="app-header"><div className="app-header-inner"><div className="flex shrink-0 items-center gap-2"><span className="brand-mark">稻</span><strong className="brand-name text-sm">RiceText</strong></div><nav className="flex h-full items-center gap-4" aria-label="主导航"><NavLink to="/compose" className={({ isActive }) => `route-tab ${isActive ? '!border-b-primary !text-primary' : ''}`}><Edit3 size={15} />编辑</NavLink><NavLink to="/read" className={({ isActive }) => `route-tab ${isActive ? '!border-b-primary !text-primary' : ''}`}><Eye size={15} />阅读</NavLink></nav><span className="flex-1" /><span className="demo-label desktop-only">演示环境</span><DropdownMenu><DropdownMenuTrigger asChild><button type="button" className="flex h-9 items-center gap-2 rounded-md px-1.5 hover:bg-muted" aria-label="切换演示身份"><span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">{value.identity.avatar}</span><span className="desktop-only text-left"><strong className="block text-xs leading-4">{value.identity.name}</strong><small className="block text-[9px] leading-3 text-muted-foreground">{value.identity.role === 'author' ? '作者' : value.identity.role === 'reader' ? '读者' : '版主'} · {value.identity.coins} 金币</small></span><ChevronDown size={13} className="text-muted-foreground" /></button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-56"><div className="px-2 py-1.5 text-[10px] font-bold text-muted-foreground">开发身份切换</div>{identities.map((identity) => <DropdownMenuItem key={identity.id} onSelect={() => value.setIdentity(identity)}><span className="grid h-7 w-7 place-items-center rounded-full bg-primary text-[10px] font-bold text-white">{identity.avatar}</span><span className="min-w-0 flex-1"><strong className="block truncate text-xs">{identity.name}</strong><small className="text-[10px] text-muted-foreground">{identity.role} · {identity.coins} 金币</small></span>{identity.id === value.identity.id && <span className="text-primary">✓</span>}</DropdownMenuItem>)}</DropdownMenuContent></DropdownMenu></div></header>;
}

/** 路由 chunk 下载期间保持页面结构稳定的轻量占位。 */
function LoadingPage() {
  return <main className="grid min-h-[60vh] place-items-center"><div className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={18} className="animate-spin text-primary" />正在装载工作区</div></main>;
}

/** 应用根组件；负责路由、身份恢复和身份选择持久化。 */
export default function App() {
  const [identity, setIdentityState] = useState(() => {
    const stored = localStorage.getItem('ricetext:identity');
    return identities.find((item) => item.id === stored) ?? identities[0]!;
  });
  // Context value 保持引用稳定，避免身份未变化时让所有页面无意义重渲染。
  const value = useMemo(() => ({ identity, setIdentity(next: typeof identity) { setIdentityState(next); localStorage.setItem('ricetext:identity', next.id); } }), [identity]);
  return <AppContext.Provider value={value}><BrowserRouter><div className="app-shell"><AppHeader /><Suspense fallback={<LoadingPage />}><Routes><Route path="/compose" element={<ComposePage />} /><Route path="/read" element={<ReadPage />} /><Route path="*" element={<Navigate to="/compose" replace />} /></Routes></Suspense></div></BrowserRouter></AppContext.Provider>;
}
