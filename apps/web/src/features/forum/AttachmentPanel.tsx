import { Coins, Download, FileArchive } from "lucide-react";
import { Button } from "../../components/ui";
import type { SeedIdentity } from "../../lib/types";
import { useAttachment } from "./useAttachment";

/** 附件金币购买与 70% 作者分成，数据来自服务端。 */
export function AttachmentPanel({ identity }: { identity: SeedIdentity }) {
  const { attachment, isLoading, purchasing, error, buy } = useAttachment();

  if (isLoading || !attachment)
    return <p className="text-xs text-muted-foreground">加载中…</p>;
  const purchased = attachment.purchased;
  const affordable = identity.coins >= attachment.price;

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded bg-[#fdf1f0] px-2 py-1.5 text-[11px] text-[#8f2b24]">
          {error}
        </p>
      ) : null}
      <article className="rounded-md border border-border p-3">
        <div className="flex gap-3">
          <span className="grid h-10 w-10 place-items-center rounded bg-[#edf2f3] text-[#59656f]">
            <FileArchive size={19} />
          </span>
          <div className="min-w-0 flex-1">
            <strong className="block truncate text-xs">
              {attachment.name}
            </strong>
            <small className="text-[10px] text-muted-foreground">
              {attachment.mimeType}
            </small>
          </div>
        </div>
        <div className="mt-3 flex items-center justify-between rounded bg-[#fff8e8] px-2 py-2 text-xs">
          <span className="flex items-center gap-1 font-bold text-[#825209]">
            <Coins size={14} />
            {attachment.price} 金币
          </span>
          <span className="text-[10px] text-[#8a682b]">
            作者获得 {Math.floor(attachment.price * 0.7)}（70%）
          </span>
        </div>
        <Button
          className="mt-3 w-full"
          size="sm"
          disabled={purchased || !affordable || purchasing}
          onClick={() => void buy()}
        >
          {purchased ? (
            <>
              <Download size={14} />
              已购买，可下载
            </>
          ) : (
            <>
              <Coins size={14} />
              {affordable ? "购买附件" : "金币不足"}
            </>
          )}
        </Button>
      </article>
    </div>
  );
}
