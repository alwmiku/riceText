import { lazy, Suspense } from "react";
import { LoaderCircle } from "lucide-react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAppContext } from "../app-context";

// 编辑器与阅读器分别懒加载，阅读路由不会静态引入 Tiptap 编辑工具栏。
const ComposePage = lazy(() => import("../pages/ComposePage"));
const ReadPage = lazy(() => import("../pages/ReadPage"));

/** 路由 chunk 下载期间保持页面结构稳定的轻量占位。 */
function LoadingPage() {
  return (
    <main className="grid min-h-[60vh] place-items-center">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle size={18} className="animate-spin text-primary" />
        正在装载工作区
      </div>
    </main>
  );
}

/** 页面路由与异步加载边界。 */
export function AppRoutes() {
  const { authStatus } = useAppContext();
  const readElement =
    authStatus === "unauthenticated" || authStatus === "error" ? (
      <Navigate to="/compose" replace />
    ) : (
      <ReadPage />
    );
  return (
    <Suspense fallback={<LoadingPage />}>
      <Routes>
        <Route path="/compose" element={<ComposePage />} />
        <Route path="/read" element={readElement} />
        <Route path="*" element={<Navigate to="/compose" replace />} />
      </Routes>
    </Suspense>
  );
}
