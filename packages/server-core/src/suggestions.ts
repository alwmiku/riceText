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

/** 在不修改源文档的前提下替换首个匹配片段，供单条建议审核使用。 */
export function replaceFirstText(
  content: TiptapDocument,
  fromText: string,
  toText: string,
): TiptapDocument | null {
  const cloned = structuredClone(content);
  let replaced = false;
  const visit = (node: TiptapNode): void => {
    if (!replaced && node.type === "text" && node.text?.includes(fromText)) {
      node.text = node.text.replace(fromText, toText);
      replaced = true;
    }
    for (const child of node.content ?? []) visit(child);
  };
  for (const node of cloned.content) visit(node);
  return replaced ? cloned : null;
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
  if (canonicalJson(existing) !== canonicalJson(before)) return null;
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
    ? applyStepsToDocument(sharedSchema(), expected as unknown as JSONContent, [])
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
