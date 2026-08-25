import type { JSONContent } from '@tiptap/core'
import {
  ALLOWED_DOCUMENT_FONT_FAMILIES,
  ALLOWED_DOCUMENT_FONT_SIZES,
  DOCUMENT_MARK_ATTRIBUTES,
  DOCUMENT_NODE_ATTRIBUTES,
  MAX_DOCUMENT_DEPTH as POLICY_MAX_DOCUMENT_DEPTH,
  MAX_DOCUMENT_NODES as POLICY_MAX_DOCUMENT_NODES,
} from '@ricetext/contracts'

import type {
  AttachmentReferenceAttributes,
  DiceRollAttributes,
  DocumentValidationIssue,
  DocumentValidationResult,
  InlineCommentAnchorAttributes,
  LongTextBlockAttributes,
  MentionAttributes,
  NovelExcerptAttributes,
  PollOptionReference,
  PollReferenceAttributes,
  ReplyGateAttributes,
  RichImageAttributes,
} from './types.js'

/** 单个文档中可接受的 JSON 节点最大数量。 */
export const MAX_DOCUMENT_NODES = POLICY_MAX_DOCUMENT_NODES

/** 净化器可接受的最大嵌套深度。 */
export const MAX_DOCUMENT_DEPTH = POLICY_MAX_DOCUMENT_DEPTH

/** `textStyle` 可持久化的字体族。 */
export const ALLOWED_FONT_FAMILIES = ALLOWED_DOCUMENT_FONT_FAMILIES

/** `textStyle` 可持久化的像素字号。 */
export const ALLOWED_FONT_SIZES = ALLOWED_DOCUMENT_FONT_SIZES

const allowedFontSet = new Set<string>(ALLOWED_FONT_FAMILIES)
const allowedFontSizeSet = new Set<number>(ALLOWED_FONT_SIZES)
const allowedSimpleMarks = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'spoiler'])
const allowedNodes = new Set(Object.keys(DOCUMENT_NODE_ATTRIBUTES))

const blockNodes = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'blockquote', 'codeBlock', 'horizontalRule', 'richImage', 'novelExcerpt', 'replyGate', 'attachmentRef', 'pollRef', 'longTextBlock'])
const inlineNodes = new Set(['text', 'hardBreak', 'inlineCommentAnchor', 'diceRoll', 'mention'])
const atomNodes = new Set(['hardBreak', 'horizontalRule', 'inlineCommentAnchor', 'richImage', 'diceRoll', 'mention', 'attachmentRef', 'pollRef', 'longTextBlock'])

const nodeAttributeAllowlist: Readonly<Record<string, readonly string[]>> =
  DOCUMENT_NODE_ATTRIBUTES
const markAttributeAllowlist: Readonly<Record<string, readonly string[]>> =
  DOCUMENT_MARK_ATTRIBUTES

interface SanitizerContext {
  issues: DocumentValidationIssue[]
  nodeCount: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function addIssue(context: SanitizerContext, value: DocumentValidationIssue): void {
  context.issues.push(value)
}

function reportUnknownAttributes(context: SanitizerContext, path: string, attrs: Record<string, unknown>, allowed: readonly string[]): void {
  const allow = new Set(allowed)
  for (const name of Object.keys(attrs)) {
    if (!allow.has(name)) {
      addIssue(context, {
        code: 'unknown-attribute',
        path: `${path}.attrs.${name}`,
        message: `Attribute ${name} is not allowed and was removed.`,
      })
    }
  }
}

function stringValue(value: unknown, maxLength: number, fallback = ''): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback
}

function nullableString(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string' || value.length === 0) return null
  return value.slice(0, maxLength)
}

function finiteInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })
}

/**
 * 返回所请求内容类型的安全 URL，被拒绝时返回 `null`。
 * 图片 URL 接受 HTTP(S)、`/uploads/...`、`/api/assets/...` 以及本地
 * `blob:` 对象 URL；链接额外接受 `mailto:`、锚点片段以及普通同源路径。
 */
export function sanitizeUrl(value: unknown, kind: 'image' | 'link' = 'link'): string | null {
  if (typeof value !== 'string') return null
  if (containsControlCharacter(value)) return null
  const candidate = value.trim()
  if (!candidate || candidate.length > 2_048) return null
  if ((candidate.startsWith('/uploads/') || candidate.startsWith('/api/assets/')) && !candidate.includes('\\')) return candidate
  if (kind === 'image' && candidate.startsWith('blob:') && !candidate.includes('\\')) return candidate
  if (kind === 'link' && (candidate.startsWith('/') || candidate.startsWith('#'))) return candidate
  try {
    const url = new URL(candidate)
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.toString()
    if (kind === 'link' && url.protocol === 'mailto:') return url.toString()
  } catch {
    return null
  }
  return null
}

/** 返回归一化的 CSS 颜色标记；不安全的输入返回 `null`。 */
export function sanitizeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const color = value.trim().toLowerCase()
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/u.test(color)) return color
  if (/^rgb\(\s*(?:\d{1,3}\s*,\s*){2}\d{1,3}\s*\)$/u.test(color)) {
    const channels = color.match(/\d+/gu)?.map(Number) ?? []
    return channels.length === 3 && channels.every((channel) => channel <= 255) ? `rgb(${channels.join(', ')})` : null
  }
  return null
}

/** 返回白名单内的字体族；值不允许时返回 `null`。 */
export function sanitizeFontFamily(value: unknown): string | null {
  return typeof value === 'string' && allowedFontSet.has(value) ? value : null
}

/** 返回白名单内的像素字号；值不允许时返回 `null`。 */
export function sanitizeFontSize(value: unknown): string | null {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' ? Number.parseInt(value, 10) : Number.NaN
  return allowedFontSizeSet.has(numeric) ? `${numeric}px` : null
}

function sanitizeMarks(value: unknown, path: string, context: SanitizerContext): JSONContent['marks'] {
  if (!Array.isArray(value)) return undefined
  const marks: NonNullable<JSONContent['marks']> = []
  for (let index = 0; index < value.length; index += 1) {
    const raw = value[index]
    const markPath = `${path}.marks[${index}]`
    if (!isRecord(raw) || typeof raw.type !== 'string') {
      addIssue(context, { code: 'unknown-mark', path: markPath, message: 'Malformed mark was removed.' })
      continue
    }
    const attrs = isRecord(raw.attrs) ? raw.attrs : {}
    if (allowedSimpleMarks.has(raw.type)) {
      reportUnknownAttributes(context, markPath, attrs, markAttributeAllowlist[raw.type] ?? [])
      marks.push({ type: raw.type })
      continue
    }
    if (raw.type === 'link') {
      reportUnknownAttributes(context, markPath, attrs, markAttributeAllowlist.link ?? [])
      const href = sanitizeUrl(attrs.href, 'link')
      if (!href) {
        addIssue(context, { code: 'unsafe-url', path: `${markPath}.attrs.href`, message: 'Unsafe link URL was removed.' })
        continue
      }
      marks.push({ type: 'link', attrs: { href, target: '_blank', rel: 'noopener noreferrer nofollow' } })
      continue
    }
    if (raw.type === 'textStyle') {
      reportUnknownAttributes(context, markPath, attrs, markAttributeAllowlist.textStyle ?? [])
      const safeAttrs: Record<string, string> = {}
      const color = sanitizeColor(attrs.color)
      const fontFamily = sanitizeFontFamily(attrs.fontFamily)
      const fontSize = sanitizeFontSize(attrs.fontSize)
      if (attrs.color !== undefined && !color) addIssue(context, { code: 'invalid-attribute', path: `${markPath}.attrs.color`, message: 'Invalid text color was removed.' })
      if (attrs.fontFamily !== undefined && !fontFamily) addIssue(context, { code: 'invalid-attribute', path: `${markPath}.attrs.fontFamily`, message: 'Font family is not in the allowlist.' })
      if (attrs.fontSize !== undefined && !fontSize) addIssue(context, { code: 'invalid-attribute', path: `${markPath}.attrs.fontSize`, message: 'Font size is not in the allowlist.' })
      if (color) safeAttrs.color = color
      if (fontFamily) safeAttrs.fontFamily = fontFamily
      if (fontSize) safeAttrs.fontSize = fontSize
      if (Object.keys(safeAttrs).length > 0) marks.push({ type: 'textStyle', attrs: safeAttrs })
      continue
    }
    addIssue(context, { code: 'unknown-mark', path: markPath, message: `Mark ${raw.type} is not allowed and was removed.` })
  }
  if (marks.some((mark) => mark.type === 'spoiler')) {
    const spoilerSafeMarks: NonNullable<JSONContent['marks']> = []
    for (const mark of marks) {
      if (mark.type === 'bold' || mark.type === 'italic') {
        addIssue(context, { code: 'invalid-attribute', path, message: `${mark.type} is not allowed inside spoiler and was removed.` })
        continue
      }
      if (mark.type === 'textStyle') {
        addIssue(context, { code: 'invalid-attribute', path, message: 'Text style is not allowed inside spoiler and was removed.' })
        continue
      }
      spoilerSafeMarks.push(mark)
    }
    return spoilerSafeMarks.length > 0 ? spoilerSafeMarks : undefined
  }
  return marks.length > 0 ? marks : undefined
}

/** 按节点类型重建 attrs，而不是在原对象上删除字段，防止修改调用方输入。 */
function sanitizeNodeAttributes(type: string, raw: Record<string, unknown>, path: string, context: SanitizerContext): Record<string, unknown> | undefined {
  reportUnknownAttributes(context, path, raw, nodeAttributeAllowlist[type] ?? [])
  const safeImageUrl = (value: unknown, attrPath: string): string | null => {
    if (value === null || value === undefined || value === '') return null
    const result = sanitizeUrl(value, 'image')
    if (!result) addIssue(context, { code: 'unsafe-url', path: attrPath, message: 'Unsafe image URL was removed.' })
    return result
  }
  const safeLinkUrl = (value: unknown, attrPath: string): string | null => {
    if (value === null || value === undefined || value === '') return null
    const result = sanitizeUrl(value, 'link')
    if (!result) addIssue(context, { code: 'unsafe-url', path: attrPath, message: 'Unsafe source URL was removed.' })
    return result
  }

  switch (type) {
    case 'paragraph':
    case 'heading':
    case 'listItem': {
      const textAlign = raw.textAlign === 'center' || raw.textAlign === 'right' || raw.textAlign === 'justify' ? raw.textAlign : 'left'
      return type === 'heading' ? { level: finiteInteger(raw.level, 2, 1, 6), textAlign } : { textAlign }
    }
    case 'orderedList': return { start: finiteInteger(raw.start, 1, 1, 1_000_000) }
    case 'codeBlock': return { language: nullableString(raw.language, 40) }
    case 'inlineCommentAnchor': {
      const attrs: InlineCommentAnchorAttributes = {
        threadId: stringValue(raw.threadId, 128),
        count: finiteInteger(raw.count, 0, 0, 1_000_000),
        placement: raw.placement === 'start' ? 'start' : 'end',
      }
      return attrs as unknown as Record<string, unknown>
    }
    case 'richImage': {
      const attrs: RichImageAttributes = {
        assetId: nullableString(raw.assetId, 128),
        src: safeImageUrl(raw.src, `${path}.attrs.src`) ?? '',
        alt: stringValue(raw.alt, 500),
        caption: stringValue(raw.caption, 1_000),
        align: raw.align === 'left' || raw.align === 'right' ? raw.align : 'center',
        width: finiteInteger(raw.width, 100, 10, 100),
      }
      return attrs as unknown as Record<string, unknown>
    }
    case 'diceRoll': {
      const rolls = Array.isArray(raw.rolls) ? raw.rolls.slice(0, 100).map((roll) => finiteInteger(roll, 0, -1_000_000, 1_000_000)) : []
      const attrs: DiceRollAttributes = {
        rollId: stringValue(raw.rollId, 128),
        expression: stringValue(raw.expression, 80),
        rolls,
        total: finiteInteger(raw.total, 0, -100_000_000, 100_000_000),
        rerollOf: nullableString(raw.rerollOf, 128),
      }
      return attrs as unknown as Record<string, unknown>
    }
    case 'novelExcerpt': {
      const attrs: NovelExcerptAttributes = {
        bookTitle: stringValue(raw.bookTitle, 300), chapterTitle: stringValue(raw.chapterTitle, 300), author: stringValue(raw.author, 200),
        sourceUrl: safeLinkUrl(raw.sourceUrl, `${path}.attrs.sourceUrl`),
        variant: raw.variant === 'mobile-book' || raw.variant === 'forum-evidence' ? raw.variant : 'desktop-book',
      }
      return attrs as unknown as Record<string, unknown>
    }
    case 'mention': {
      const attrs: MentionAttributes = {
        userId: nullableString(raw.userId, 128), name: stringValue(raw.name, 100), resolved: raw.resolved === true,
        avatarUrl: safeImageUrl(raw.avatarUrl, `${path}.attrs.avatarUrl`),
      }
      return attrs as unknown as Record<string, unknown>
    }
    case 'replyGate': {
      const attrs: ReplyGateAttributes = { gateId: stringValue(raw.gateId, 128), prompt: stringValue(raw.prompt, 300, 'Reply to view this content') }
      return attrs as unknown as Record<string, unknown>
    }
    case 'attachmentRef': {
      const attrs: AttachmentReferenceAttributes = {
        attachmentId: stringValue(raw.attachmentId, 128), name: stringValue(raw.name, 300),
        mimeType: stringValue(raw.mimeType, 120, 'application/octet-stream'),
        size: finiteInteger(raw.size, 0, 0, Number.MAX_SAFE_INTEGER), priceCoins: finiteInteger(raw.priceCoins, 0, 0, 1_000_000_000),
      }
      return attrs as unknown as Record<string, unknown>
    }
    case 'pollRef': {
      const options: PollOptionReference[] = []
      if (Array.isArray(raw.options)) {
        for (const option of raw.options.slice(0, 100)) {
          if (!isRecord(option)) continue
          const id = stringValue(option.id, 128)
          const label = stringValue(option.label, 300)
          if (id && label) options.push({ id, label })
        }
      }
      const attrs: PollReferenceAttributes = {
        pollId: stringValue(raw.pollId, 128), question: stringValue(raw.question, 500), multiple: raw.multiple === true, options,
      }
      return attrs as unknown as Record<string, unknown>
    }
    case 'longTextBlock': {
      const attrs: LongTextBlockAttributes = {
        chapterId: stringValue(raw.chapterId, 128),
        title: stringValue(raw.title, 500),
        text: stringValue(raw.text, 100_000_000),
        order: finiteInteger(raw.order, 0, 0, 1_000_000),
        start:
          raw.start === null || raw.start === undefined
            ? null
            : finiteInteger(raw.start, 0, 0, 10_000_000_000),
        end:
          raw.end === null || raw.end === undefined
            ? null
            : finiteInteger(raw.end, 0, 0, 10_000_000_000),
      }
      return attrs as unknown as Record<string, unknown>
    }
    default: return undefined
  }
}

/** 描述共享 ProseMirror schema 的父子结构约束。 */
function childAllowed(parentType: string | null, childType: string): boolean {
  if (parentType === null) return childType === 'doc'
  if (parentType === 'doc' || parentType === 'blockquote' || parentType === 'novelExcerpt' || parentType === 'replyGate' || parentType === 'listItem') return blockNodes.has(childType)
  if (parentType === 'paragraph' || parentType === 'heading') return inlineNodes.has(childType)
  if (parentType === 'bulletList' || parentType === 'orderedList') return childType === 'listItem'
  if (parentType === 'codeBlock') return childType === 'text'
  return false
}

/** 带 JSON 路径、深度和总节点计数的递归净化器。 */
function sanitizeNode(value: unknown, path: string, depth: number, context: SanitizerContext, parentType: string | null): JSONContent | null {
  if (depth > MAX_DOCUMENT_DEPTH) {
    addIssue(context, { code: 'limit-exceeded', path, message: 'Maximum document depth was exceeded.' })
    return null
  }
  if (context.nodeCount >= MAX_DOCUMENT_NODES) {
    addIssue(context, { code: 'limit-exceeded', path, message: 'Maximum document node count was exceeded.' })
    return null
  }
  context.nodeCount += 1
  if (!isRecord(value) || typeof value.type !== 'string' || !allowedNodes.has(value.type)) {
    const type = isRecord(value) && typeof value.type === 'string' ? value.type : 'malformed'
    addIssue(context, { code: 'unknown-node', path, message: `Node ${type} is not allowed and was removed.` })
    return null
  }
  if (!childAllowed(parentType, value.type)) {
    addIssue(context, { code: 'invalid-structure', path, message: `Node ${value.type} is not valid inside ${parentType ?? 'the document root'} and was removed.` })
    return null
  }

  const rawAttrs = isRecord(value.attrs) ? value.attrs : {}
  if (value.type === 'text') {
    reportUnknownAttributes(context, path, rawAttrs, [])
    if (typeof value.text !== 'string') {
      addIssue(context, { code: 'invalid-attribute', path: `${path}.text`, message: 'Text node without text was removed.' })
      return null
    }
    const marks = parentType === 'codeBlock' ? undefined : sanitizeMarks(value.marks, path, context)
    if (parentType === 'codeBlock' && Array.isArray(value.marks) && value.marks.length > 0) {
      addIssue(context, { code: 'invalid-structure', path: `${path}.marks`, message: 'Marks are not valid inside a code block and were removed.' })
    }
    const node: JSONContent = { type: 'text', text: value.text.slice(0, 1_000_000) }
    if (marks) node.marks = marks
    return node
  }

  const node: JSONContent = { type: value.type }
  const attrs = sanitizeNodeAttributes(value.type, rawAttrs, path, context)
  if (attrs && Object.keys(attrs).length > 0) node.attrs = attrs
  if (value.type === 'diceRoll' || value.type === 'mention') {
    const marks = sanitizeMarks(value.marks, path, context)
    if (marks) node.marks = marks
  }
  if (atomNodes.has(value.type) && Array.isArray(value.content) && value.content.length > 0) {
    addIssue(context, { code: 'invalid-structure', path: `${path}.content`, message: `Atomic node ${value.type} cannot contain child nodes.` })
  } else if (Array.isArray(value.content)) {
    const content: JSONContent[] = []
    for (let index = 0; index < value.content.length; index += 1) {
      const child = sanitizeNode(value.content[index], `${path}.content[${index}]`, depth + 1, context, value.type)
      if (child) content.push(child)
    }
    if (content.length > 0) node.content = content
  }
  if ((value.type === 'doc' || value.type === 'blockquote' || value.type === 'novelExcerpt' || value.type === 'replyGate' || value.type === 'listItem') && !node.content?.length) {
    node.content = [{ type: 'paragraph', attrs: { textAlign: 'left' } }]
  }
  if ((value.type === 'bulletList' || value.type === 'orderedList') && !node.content?.length) {
    node.content = [{ type: 'listItem', content: [{ type: 'paragraph', attrs: { textAlign: 'left' } }] }]
  }
  return node
}

function removeInlineCommentAnchorsInsideReplyGate(node: JSONContent, insideReplyGate = false): void {
  const nextInsideReplyGate = insideReplyGate || node.type === 'replyGate'
  if (Array.isArray(node.content)) {
    if (nextInsideReplyGate) {
      node.content = node.content.filter((child) => child.type !== 'inlineCommentAnchor')
    }
    for (const child of node.content) removeInlineCommentAnchorsInsideReplyGate(child, nextInsideReplyGate)
  }
}

function inspectDocument(value: unknown): DocumentValidationResult {
  const context: SanitizerContext = { issues: [], nodeCount: 0 }
  if (!isRecord(value) || value.type !== 'doc') {
    addIssue(context, { code: 'invalid-document', path: '$', message: 'Root node must be a Tiptap document.' })
    return { valid: false, document: { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'left' } }] }, issues: context.issues }
  }
  const document = sanitizeNode(value, '$', 0, context, null) ?? { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'left' } }] }
  removeInlineCommentAnchorsInsideReplyGate(document)
  return { valid: context.issues.length === 0, document, issues: context.issues }
}

/** 从不信任的 JSON 中移除未知结构与不安全值，且不修改原始输入。 */
export function sanitizeDocument(value: unknown): JSONContent {
  return inspectDocument(value).document
}

/** 校验 JSON，并返回有序诊断信息及安全替换结果。 */
export function validateDocument(value: unknown): DocumentValidationResult {
  return inspectDocument(value)
}

/** 解析序列化的 JSON；输入无效时返回安全的空文档。 */
export function parseDocumentJson(serialized: string): DocumentValidationResult {
  try {
    return inspectDocument(JSON.parse(serialized) as unknown)
  } catch {
    const document: JSONContent = { type: 'doc', content: [{ type: 'paragraph', attrs: { textAlign: 'left' } }] }
    return { valid: false, document, issues: [{ code: 'invalid-document', path: '$', message: 'Document is not valid JSON.' }] }
  }
}

/** 序列化已净化的文档，用于传输或持久化。 */
export function stringifyDocument(value: unknown): string {
  return JSON.stringify(sanitizeDocument(value))
}
