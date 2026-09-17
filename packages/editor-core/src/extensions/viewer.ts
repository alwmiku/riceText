import { type Extensions } from "@tiptap/core";

import { addViewerNodeViews } from "../viewer/node-views.js";
import type { ViewerContextRef } from "../viewer/types.js";
import { schemaExtensions } from "./schema.js";
import { SpoilerOverlay } from "./spoiler-overlay.js";

/**
 * 直接基于规范持久化结构创建只读组合。
 *
 * 末尾追加的 SpoilerOverlay 与编辑器共用同一份实现：它只读取正文 DOM 尺寸并绘制覆盖层，
 * 不依赖可编辑状态。
 */
export function createViewerExtensions(
  viewerRef: ViewerContextRef,
): Extensions {
  return addViewerNodeViews(schemaExtensions(), viewerRef).concat(SpoilerOverlay);
}
