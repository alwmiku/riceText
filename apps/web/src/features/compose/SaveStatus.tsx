import { CloudOff, LoaderCircle } from "lucide-react";
import type { SaveState } from "../../lib/types";
import { formatTime } from "../../lib/utils";

const statusLabels: Record<SaveState, string> = {
  loading: "正在载入",
  saved: "已保存",
  dirty: "等待保存",
  saving: "正在保存",
  conflict: "版本冲突",
  offline: "本地缓存副本",
  error: "保存失败",
};

export function SaveStatus({
  state,
  revision,
  savedAt,
}: {
  state: SaveState;
  revision: number;
  savedAt: string;
}) {
  const dotColor =
    state === "saved"
      ? "bg-[#209065]"
      : state === "dirty" || state === "saving"
        ? "bg-[#c47b0b]"
        : state === "conflict" || state === "error"
          ? "bg-[#c83d3d]"
          : "bg-[#9aa4ae]";

  return (
    <span
      className="save-status inline-flex items-center gap-1.5 text-xs whitespace-nowrap text-[#65717e]"
      data-state={state}
    >
      {state === "saving" ? (
        <LoaderCircle size={12} className="animate-spin" />
      ) : state === "offline" ? (
        <CloudOff size={12} />
      ) : (
        <span className={`h-[7px] w-[7px] rounded-full ${dotColor}`} />
      )}
      <span>
        {statusLabels[state]} · v{revision}
      </span>
      {(state === "saved" || state === "offline") ? (
        <span className="max-[840px]:hidden">· {formatTime(savedAt)}</span>
      ) : null}
    </span>
  );
}
