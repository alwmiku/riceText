import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useAppContext } from "../../app-context";
import { listDocuments } from "../../lib/api";
import { createId } from "../../lib/utils";

const selectionKey = "ricetext:selected-document";

/** 登录用户共享文章选择；游客始终隔离到只存在浏览器中的空白文档。 */
export function useArticleSelection() {
  const { identity, authStatus } = useAppContext();
  const authenticated = authStatus === "authenticated";
  const query = useQuery({
    queryKey: ["documents"],
    queryFn: listDocuments,
    enabled: authenticated,
  });
  const articles = query.data ?? [];
  const [selectedId, setSelectedIdState] = useState(() =>
    localStorage.getItem(selectionKey) ?? "",
  );

  useEffect(() => {
    if (!authenticated || query.isLoading) return;
    // 非空选择也可能是尚未上传的新文章；服务端 404 会安全落到本地创建态。
    if (selectedId) return;
    const next = articles[0]?.id ?? "";
    setSelectedIdState(next);
    if (next) localStorage.setItem(selectionKey, next);
    else localStorage.removeItem(selectionKey);
  }, [articles, authenticated, query.isLoading, selectedId]);

  const setSelectedId = (id: string) => {
    setSelectedIdState(id);
    localStorage.setItem(selectionKey, id);
  };
  const createArticle = () => {
    const id = createId("article");
    setSelectedIdState(id);
    localStorage.setItem(selectionKey, id);
    return id;
  };
  return {
    authenticated,
    articles,
    loading: authStatus === "loading" || (authenticated && query.isLoading),
    selectedId: authenticated ? selectedId : "guest-local",
    canCreate: authenticated && identity.role !== "reader",
    setSelectedId,
    createArticle,
  };
}
