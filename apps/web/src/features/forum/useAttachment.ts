import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getAttachment, purchaseAttachment } from "../../lib/api/attachments";
import { forumQueryKeys } from "./query-keys";

const attachmentId = "attachment-sample";

export function useAttachment() {
  const queryClient = useQueryClient();
  const [error, setError] = useState("");
  const attachmentQuery = useQuery({
    queryKey: forumQueryKeys.attachment(attachmentId),
    queryFn: ({ signal }) => getAttachment(attachmentId, signal),
  });
  const purchaseMutation = useMutation({
    mutationFn: () => purchaseAttachment(attachmentId),
  });

  const buy = async () => {
    setError("");
    try {
      await purchaseMutation.mutateAsync();
      await queryClient.invalidateQueries({
        queryKey: forumQueryKeys.attachment(attachmentId),
      });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "购买失败");
    }
  };

  return {
    attachment: attachmentQuery.data,
    isLoading: attachmentQuery.isLoading,
    purchasing: purchaseMutation.isPending,
    error,
    buy,
  };
}
