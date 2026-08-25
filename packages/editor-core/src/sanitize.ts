/**
 * 文档净化与校验统一由 @ricetext/document-core 提供（服务端与编辑器共用），
 * 此处保留既有导出路径兼容。
 */
export {
  MAX_DOCUMENT_NODES,
  MAX_DOCUMENT_DEPTH,
  ALLOWED_FONT_FAMILIES,
  ALLOWED_FONT_SIZES,
  sanitizeUrl,
  sanitizeColor,
  sanitizeFontFamily,
  sanitizeFontSize,
  sanitizeDocument,
  validateDocument,
  parseDocumentJson,
  stringifyDocument,
} from "@ricetext/document-core";
