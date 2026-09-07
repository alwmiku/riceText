import { type Extensions } from "@tiptap/core";

import { addViewerNodeViews } from "../viewer/node-views.js";
import type { ViewerContextRef } from "../viewer/types.js";
import { schemaExtensions } from "./schema.js";

/** 直接基于规范持久化结构创建只读组合。 */
export function createViewerExtensions(
  viewerRef: ViewerContextRef,
): Extensions {
  return addViewerNodeViews(schemaExtensions(), viewerRef);
}
