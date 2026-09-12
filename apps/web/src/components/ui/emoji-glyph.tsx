import { useState } from "react";
import { emojiAssetPath, emojiThumbnailPath, type EmojiCatalogEntry } from "@ricetext/contracts";
import { cn } from "@/lib/utils";

/**
 * 单个表情的渲染：自定义表情显示图片，加载失败或纯文本表情显示字符本身。
 * 面板、触发器浮层与建议列表共用，保证三处观感一致。
 *
 * `animated` 决定用完整动图还是构建期生成的首帧缩略图：只有写进正文的图片才播动画，
 * 面板里同时显示十几个 500×500 动图会造成明显的解码与内存开销。
 */
export function EmojiGlyph({
  entry,
  size = 22,
  animated = false,
  className,
}: {
  entry: EmojiCatalogEntry;
  /** 图片边长（px）；纯文本表情的字号按同尺寸换算。 */
  size?: number;
  /** 使用完整动图（正文渲染），否则用静态首帧缩略图（面板/候选列表）。 */
  animated?: boolean;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  // 只有动图有首帧缩略图；PNG 表情直接用它自己的图片。
  const source = animated
    ? emojiAssetPath(entry.id)
    : (emojiThumbnailPath(entry.id) ?? emojiAssetPath(entry.id));
  if (source && !failed) {
    return (
      <img
        src={source}
        alt={entry.name}
        title={entry.name}
        width={size}
        height={size}
        loading="lazy"
        draggable={false}
        className={cn("inline-block object-contain", className)}
        style={{ width: size, height: size }}
        onError={() => setFailed(true)}
      />
    );
  }
  return (
    <span
      role="img"
      aria-label={entry.name}
      title={entry.name}
      className={cn("inline-block leading-none", className)}
      style={{ fontSize: Math.round(size * 0.82) }}
    >
      {entry.text}
    </span>
  );
}
