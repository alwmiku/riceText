import type { TiptapDocument, TiptapNode } from "@ricetext/contracts";
import {
  applyStepsToDocument,
  getChapterRange,
  replaceChapter,
  sharedSchema,
  type JSONContent,
  type StepJson,
} from "@ricetext/document-core";
import { DomainError } from "./errors";
import { sanitizeDocumentForWrite } from "./documents";

function sortObjectKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortObjectKeys);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = sortObjectKeys((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortObjectKeys(value));
}

/** 服务端通过 (documentId, chapterId) 查得的当前章节顺序；null 表示身份已失效。 */
export interface SuggestionLocation {
  chapterId: string;
  chapterOrder: number | null;
  /** 独立章节正文存在时，必须与文档中的章节快照一致才能走全文审核路径。 */
  chapterContent?: TiptapDocument | null;
  lineNo: number;
  lineText: string;
}

/**
 * 单条纠错只应用到唯一位置。章节身份由调用端查库解析，绝不解析客户端 ID/标题。
 * 行号命中时仍核对完整行；行号漂移时只允许章内唯一上下文。无定位旧建议全文唯一。
 * 匹配可跨相邻带不同 marks 的文字节点，但不能跨段落或内联原子节点。
 */
export function applySuggestionText(
  content: TiptapDocument,
  fromText: string,
  toText: string,
  location: SuggestionLocation,
): TiptapDocument {
  const missing = (): never => {
    throw new DomainError(
      409,
      "SUGGESTION_SOURCE_NOT_FOUND",
      "当前正文已找不到建议的原文或定位上下文",
    );
  };
  const ambiguous = (): never => {
    throw new DomainError(
      409,
      "SUGGESTION_SOURCE_AMBIGUOUS",
      "建议对应多个位置，无法安全应用",
    );
  };
  if (!fromText) return missing();
  let start = 0;
  let end = content.content.length;
  if (location.chapterId) {
    if (
      location.chapterOrder === null ||
      !Number.isSafeInteger(location.chapterOrder) ||
      location.chapterOrder < 0
    )
      return missing();
    const range = getChapterRange(
      content as JSONContent,
      location.chapterOrder,
    );
    if (!range) return missing();
    ({ start, end } = range);
    if (location.chapterContent) {
      const snapshot: TiptapDocument = {
        type: "doc",
        content: content.content.slice(start, end),
      };
      if (
        canonicalJson(sanitizeDocumentForWrite(location.chapterContent)) !==
        canonicalJson(sanitizeDocumentForWrite(snapshot))
      )
        return missing();
    }
  } else if (location.lineNo !== 0 || location.lineText) {
    // 删除章节会清空外键但保留行信息；不能把它当作无定位旧建议。
    return missing();
  }

  const cloned = structuredClone(content);
  type Segment = {
    node: TiptapNode;
    parent: TiptapNode;
    index: number;
    start: number;
    end: number;
  };
  const allLines = cloned.content.map((block) => {
    let text = "";
    const segments: Segment[] = [];
    const visit = (parent: TiptapNode): void => {
      for (const [index, node] of (parent.content ?? []).entries()) {
        if (node.type === "text") {
          const offset = text.length;
          text += node.text ?? "";
          segments.push({
            node,
            parent,
            index,
            start: offset,
            end: text.length,
          });
        } else visit(node);
      }
    };
    visit(block);
    return { text, segments };
  });
  const lines = allLines.slice(start, end);
  // 旧建议缺少行上下文时，即使有章节提示也必须全文唯一。
  let candidates = allLines;
  if (location.lineText) {
    const numbered = lines[location.lineNo - 1];
    candidates =
      numbered?.text === location.lineText
        ? [numbered]
        : lines.filter((line) => line.text === location.lineText);
    if (candidates.length > 1) return ambiguous();
  } else if (location.lineNo !== 0) {
    // 单独行号无法证明正文未漂移。
    return missing();
  }

  const matches: Array<{ segments: Segment[]; offset: number }> = [];
  for (const line of candidates) {
    // 步长为 1，也统计重叠匹配（如 aaa 中的 aa）。
    for (
      let offset = line.text.indexOf(fromText);
      offset >= 0;
      offset = line.text.indexOf(fromText, offset + 1)
    ) {
      matches.push({ segments: line.segments, offset });
      if (matches.length > 1) return ambiguous();
    }
  }
  const match = matches[0];
  if (!match || !lines.some((line) => line.segments === match.segments))
    return missing();
  const finish = match.offset + fromText.length;
  const covered = match.segments.filter(
    (segment) => segment.end > match.offset && segment.start < finish,
  );
  const first = covered[0];
  const last = covered.at(-1);
  if (
    !first ||
    !last ||
    covered.some(
      (segment, index) =>
        segment.parent !== first.parent ||
        segment.index !== first.index + index,
    )
  )
    return missing();
  const prefix = first.node.text!.slice(0, match.offset - first.start);
  const suffix = last.node.text!.slice(finish - last.start);
  if (first === last) {
    first.node.text = prefix + toText + suffix;
  } else {
    first.node.text = prefix + toText;
    for (const segment of covered.slice(1, -1)) segment.node.text = "";
    last.node.text = suffix;
  }
  first.parent.content = first.parent.content!.filter(
    (node) => node.type !== "text" || node.text !== "",
  );
  return cloned;
}

/**
 * @deprecated 请使用带服务端定位的 applySuggestionText。保留原三参数签名供旧调用方迁移。
 * 兼容入口现在只允许全文唯一匹配；缺失或歧义抛出 status=409 的 DomainError，
 * 分别使用 SUGGESTION_SOURCE_NOT_FOUND / SUGGESTION_SOURCE_AMBIGUOUS，不再首次替换或返回 null。
 */
export function replaceFirstText(
  content: TiptapDocument,
  fromText: string,
  toText: string,
): TiptapDocument | null {
  return applySuggestionText(content, fromText, toText, {
    chapterId: "",
    chapterOrder: null,
    lineNo: 0,
    lineText: "",
  });
}

/** 仅当目标章节规范化后完全一致时合并批次，避免把建议套到已变化的正文。 */
export function mergeSuggestionBatch(
  current: TiptapDocument,
  chapterId: string,
  before: TiptapDocument,
  after: TiptapDocument,
): TiptapDocument | null {
  const match = /^chapter-([0-9]+)$/.exec(chapterId);
  if (!match) return null;
  const chapterIndex = Number(match[1]);
  const range = getChapterRange(current as JSONContent, chapterIndex);
  if (!range) return null;
  const existing = {
    type: "doc" as const,
    content: current.content.slice(range.start, range.end),
  };
  // 历史快照可能缺少后来新增的默认属性，比较前需先统一补齐。
  if (
    canonicalJson(sanitizeDocumentForWrite(existing)) !==
    canonicalJson(sanitizeDocumentForWrite(before))
  )
    return null;
  return replaceChapter(
    current as JSONContent,
    chapterIndex,
    after as JSONContent,
  ) as TiptapDocument;
}

/** 验证提交 steps，并证明其修改范围没有越过声明的章节快照。 */
export function validateSuggestionBatch(
  current: TiptapDocument,
  input: {
    chapterId: string;
    beforeContent: TiptapDocument;
    afterContent: TiptapDocument;
    steps: Array<Record<string, unknown>>;
  },
): TiptapDocument {
  let applied: TiptapDocument;
  try {
    applied = sanitizeDocumentForWrite(
      applyStepsToDocument(
        sharedSchema(),
        current as unknown as JSONContent,
        input.steps as unknown as StepJson[],
      ),
    );
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError(422, "INVALID_STEPS", "批量校订包含无法应用的步骤");
  }
  const expected = mergeSuggestionBatch(
    current,
    input.chapterId,
    input.beforeContent,
    input.afterContent,
  );
  const normalized = expected
    ? applyStepsToDocument(
        sharedSchema(),
        expected as unknown as JSONContent,
        [],
      )
    : null;
  if (!normalized || canonicalJson(applied) !== canonicalJson(normalized)) {
    throw new DomainError(
      422,
      "BATCH_SCOPE_MISMATCH",
      "批量校订 steps 与当前章节修改不一致",
    );
  }
  return applied;
}
