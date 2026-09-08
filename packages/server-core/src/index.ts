// 该入口只导出无 Node/Cloudflare 依赖的规则，确保两套服务端执行同一业务语义。
export { chapterStorageId } from "@ricetext/document-core";
export {
  normalizeChapterUploadManifest,
  serializeChapterUploadManifest,
  decideChapterUploadWrite,
  type ChapterUploadManifestItem,
} from "./chapter-upload";
export {
  detectImageMime,
  extensionForImage,
  sanitizeOriginalName,
  sha256Hex,
  type ImageMime,
} from "./assets";
export { DomainError } from "./errors";
export {
  projectDocumentForReader,
  repairDocumentForRead,
  sanitizeDocumentForWrite,
} from "./documents";
export {
  applySuggestionText,
  mergeSuggestionBatch,
  replaceFirstText,
  validateSuggestionBatch,
  type SuggestionLocation,
} from "./suggestions";
