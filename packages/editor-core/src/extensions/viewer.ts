import { type Extensions } from "@tiptap/core";

import { addViewerNodeViews } from "../viewer/node-views.js";
import type { ViewerContextRef } from "../viewer/types.js";
import { schemaExtensions } from "./schema.js";

/** Creates the read-only composition directly from the canonical persisted schema. */
export function createViewerExtensions(
  viewerRef: ViewerContextRef,
): Extensions {
  return addViewerNodeViews(schemaExtensions(), viewerRef);
}
