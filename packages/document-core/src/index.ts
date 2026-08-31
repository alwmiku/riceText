/** 共享文档引擎：schema、净化、steps、diff 与 apply。 */
export type { JSONContent } from "@tiptap/core";
export { ApplyStepsError } from "./errors.js";
export { parseInteger, parseJsonArray } from "./helpers.js";
export * from "./nodes.js";
export {
  chapterStartExtension,
  createDocumentExtensions,
  createDocumentSchema,
} from "./schema.js";
export {
  parseDocument,
  applyStepsToDocument,
  validateSteps,
} from "./apply.js";
export { stepFromJson, describeStepsJson, type StepJson } from "./steps.js";
export { diffDocuments, diffDocumentsVerified, sharedSchema } from "./diff.js";
export * from "./sanitize.js";
export * from "./types.js";
