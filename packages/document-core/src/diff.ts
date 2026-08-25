import type { JSONContent } from "@tiptap/core";
import {
  Fragment,
  Node as ProseMirrorNode,
  Slice,
  type Schema,
} from "@tiptap/pm/model";
import { applyStepsToDocument } from "./apply.js";
import { createDocumentSchema } from "./schema.js";
import type { StepJson } from "./steps.js";

/**
 * 文档级 diff：把两个 Tiptap JSON 文档的差异转换成最小 ReplaceStep 序列。
 *
 * 最小单元是“顶级块”（段落/标题/列表/图片…）：
 * - 完全相同的块（JSON 全等）直接跳过；
 * - 结构相同（类型 + attrs）且文本变化的文本型块配对后，用公共前缀/后缀
 *   定位，只替换真正变化的中间片段；
 * - 其余变化（块增删、容器块结构变化、mark 变化）用整块替换/插入/删除表达。
 * 回溯从文档末尾向前进行，位置基于原始（before）文档，应用时不漂移。
 */

/** 顶级块（doc.content 中的每个节点）。 */
interface DiffBlock {
  /** 块起始 pos（含）。 */
  start: number;
  /** 块结束 pos（不含）。 */
  end: number;
  node: ProseMirrorNode;
  /** 块内纯文本。 */
  text: string;
  /** 宽松结构指纹：类型 + attrs（文本型与容器块共用）。 */
  loose: string;
  /** 完整 JSON 指纹（完全匹配用）。 */
  exact: string;
  /** 是否文本型块（直接子节点均为文字/行内原子）。 */
  textLike: boolean;
}

let cachedSchema: Schema | null = null;

/** 服务端与客户端共用的规范 schema（惰性单例，构建成本高）。 */
export function sharedSchema(): Schema {
  let schema = cachedSchema;
  if (!schema) {
    schema = createDocumentSchema();
    cachedSchema = schema;
  }
  return schema;
}

/** 块内纯文本：直接 text 子节点（文本型块），容器块递归收集。 */
function blockText(node: ProseMirrorNode): string {
  let text = "";
  node.forEach((child) => {
    if (child.isText) text += child.text ?? "";
    else if (!child.isInline) text += blockText(child);
  });
  return text;
}

/** 文本型块：直接子节点全部是 text 或行内原子节点。 */
function isTextLikeBlock(node: ProseMirrorNode): boolean {
  if (node.childCount === 0) return true;
  let textLike = true;
  node.forEach((child) => {
    if (!(child.isText || (child.isInline && child.isAtom))) textLike = false;
  });
  return textLike;
}

function collectBlocks(doc: ProseMirrorNode): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let pos = 0;
  doc.forEach((node) => {
    const textLike = isTextLikeBlock(node);
    blocks.push({
      start: pos,
      end: pos + node.nodeSize,
      node,
      text: blockText(node),
      loose: `${node.type.name}:${JSON.stringify(node.attrs)}`,
      exact: JSON.stringify(node.toJSON()),
      textLike,
    });
    pos += node.nodeSize;
  });
  return blocks;
}

function commonPrefixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (length < limit && a.charCodeAt(length) === b.charCodeAt(length)) {
    length += 1;
  }
  return length;
}

function commonSuffixLength(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let length = 0;
  while (
    length < limit &&
    a.charCodeAt(a.length - 1 - length) === b.charCodeAt(b.length - 1 - length)
  ) {
    length += 1;
  }
  return length;
}

/**
 * 文本型块：返回“纯文本拼接索引”offset 对应的文档 pos。
 * 字符索引只由 text 节点推进（与 blockText 一致）；行内原子节点
 * 占 1+ 个 pos 但不消耗字符索引。
 */
function posAtCharOffset(block: DiffBlock, offset: number): number | null {
  // 块节点自身占 1 个 pos：块内第一个字符从 block.start + 1 开始。
  let pos = block.start + 1;
  let remaining = offset;
  let result: number | null = null;
  block.node.content.forEach((child) => {
    if (result !== null) return;
    if (child.isText) {
      const length = child.text?.length ?? 0;
      if (remaining <= length) {
        result = pos + remaining;
        return;
      }
      remaining -= length;
      pos += length;
    } else {
      if (remaining === 0) {
        result = pos;
        return;
      }
      pos += child.nodeSize;
    }
  });
  return result ?? null;
}

/**
 * 提取文本型块内“纯文本区间” [from, to) 的 text 节点序列；
 * 区间跨越行内原子节点间隙时无法用文本切片表达，返回 null。
 */
function sliceTextRange(
  schema: Schema,
  node: ProseMirrorNode,
  from: number,
  to: number,
): Slice | null {
  const pieces: JSONContent[] = [];
  let offset = 0;
  let crossedAtom = false;
  node.content.forEach((child) => {
    if (child.isText) {
      const length = child.text?.length ?? 0;
      const start = Math.max(from, offset);
      const end = Math.min(to, offset + length);
      if (start < end) {
        const text = (child.text ?? "").slice(start - offset, end - offset);
        if (text) {
          const marks = child.marks
            .map((mark) => mark.toJSON())
            .filter((mark) => mark && mark.type);
          pieces.push(
            marks.length > 0
              ? { type: "text", text, marks }
              : { type: "text", text },
          );
        }
      }
      offset += length;
    } else {
      // 原子节点位于两段文本之间：区间若包含该间隙则无法切片。
      if (from < offset && offset < to) crossedAtom = true;
    }
  });
  if (crossedAtom) return null;
  const fragment = Fragment.fromJSON(schema, pieces);
  return new Slice(fragment, 0, 0);
}

/** 文本型块对的最小化替换：公共前后缀 + 中间片段；无法精确定位时整块替换。 */
function minimalReplaceStep(
  schema: Schema,
  before: DiffBlock,
  after: DiffBlock,
): StepJson {
  const prefix = commonPrefixLength(before.text, after.text);
  const suffix = commonSuffixLength(
    before.text.slice(prefix),
    after.text.slice(prefix),
  );
  const from = posAtCharOffset(before, prefix);
  const to = posAtCharOffset(before, Math.max(prefix, before.text.length - suffix));
  const slice = sliceTextRange(
    schema,
    after.node,
    prefix,
    Math.max(prefix, after.text.length - suffix),
  );
  // 无法精确定位，或中间片段为空（纯文本相同、差异只在 marks/结构）时整块替换
  if (
    from === null ||
    to === null ||
    slice === null ||
    (from === to && slice.content.size === 0)
  ) {
    return {
      stepType: "replace",
      from: before.start,
      to: before.end,
      slice: blockSliceJson(after.node),
    };
  }
  return { stepType: "replace", from, to, slice: slice.toJSON() };
}

/** 把单个块节点构造成 Slice JSON（open=0 的完整块，用于整块替换/插入）。 */
function blockSliceJson(node: ProseMirrorNode): StepJson["slice"] {
  return {
    content: [node.toJSON()],
    openStart: 0,
    openEnd: 0,
  };
}

/** 生成一对同构块的替换步骤（文本型走前后缀最小化，其余整块替换）。 */
function replaceMatchedPair(
  schema: Schema,
  before: DiffBlock,
  after: DiffBlock,
): StepJson {
  if (before.textLike && after.textLike) {
    return minimalReplaceStep(schema, before, after);
  }
  return {
    stepType: "replace",
    from: before.start,
    to: before.end,
    slice: blockSliceJson(after.node),
  };
}

/**
 * 生成把 before 文档变成 after 文档的最小 ReplaceStep 序列（应用顺序）。
 * 相同块不产生步骤；差异全部表达为 replace（from === to 表示插入）。
 */
export function diffDocuments(
  before: JSONContent,
  after: JSONContent,
): StepJson[] {
  const schema = sharedSchema();
  const beforeDoc = ProseMirrorNode.fromJSON(schema, before);
  const afterDoc = ProseMirrorNode.fromJSON(schema, after);
  const beforeBlocks = collectBlocks(beforeDoc);
  const afterBlocks = collectBlocks(afterDoc);
  const n = beforeBlocks.length;
  const m = afterBlocks.length;

  // 完全匹配（JSON 全等）位置表：同构替换只允许发生在“双方都没有完全匹配”
  // 的块上，否则会偷走 LCS 中更优的配对（例如重复段落被错误替换）。
  const afterHasExactMatch = afterBlocks.map(
    (block) => beforeBlocks.some((candidate) => candidate.exact === block.exact),
  );
  const beforeHasExactMatch = beforeBlocks.map(
    (block) => afterBlocks.some((candidate) => candidate.exact === block.exact),
  );

  // 块级 LCS（按完整 JSON 指纹匹配）
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        beforeBlocks[i]!.exact === afterBlocks[j]!.exact
          ? (lcs[i + 1]![j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
    }
  }

  // 从文档末尾向前回溯并生成 steps，保证位置基于 before 文档不漂移。
  const steps: StepJson[] = [];
  let i = n - 1;
  let j = m - 1;
  while (i >= 0 && j >= 0) {
    const beforeBlock = beforeBlocks[i]!;
    const afterBlock = afterBlocks[j]!;
    if (beforeBlock.exact === afterBlock.exact) {
      i -= 1;
      j -= 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      // 跳过 before[i]（删除分支）：若与 after[j] 同构且双方都无完全匹配，
      // 直接替换（文本型块按公共前后缀最小化），否则删除。
      if (
        beforeBlock.loose === afterBlock.loose &&
        !afterHasExactMatch[j] &&
        !beforeHasExactMatch[i]
      ) {
        steps.push(replaceMatchedPair(schema, beforeBlock, afterBlock));
        i -= 1;
        j -= 1;
      } else {
        steps.push({
          stepType: "replace",
          from: beforeBlock.start,
          to: beforeBlock.end,
          slice: { content: [], openStart: 0, openEnd: 0 },
        });
        i -= 1;
      }
    } else {
      const anchor = i >= 0 ? beforeBlock.end : 0;
      steps.push({
        stepType: "replace",
        from: anchor,
        to: anchor,
        slice: blockSliceJson(afterBlock.node),
      });
      j -= 1;
    }
  }
  while (i >= 0) {
    const block = beforeBlocks[i]!;
    steps.push({
      stepType: "replace",
      from: block.start,
      to: block.end,
      slice: { content: [], openStart: 0, openEnd: 0 },
    });
    i -= 1;
  }
  while (j >= 0) {
    const block = afterBlocks[j]!;
    steps.push({
      stepType: "replace",
      from: 0,
      to: 0,
      slice: blockSliceJson(block.node),
    });
    j -= 1;
  }

  // 后处理：把相邻的“删除 + 插入（插入点与删除区间衔接）”合并为单个替换。
  // 只有删除在前、插入在后才与 replace 等价（插入在前会偏移删除区间）。
  const merged: StepJson[] = [];
  for (let index = 0; index < steps.length; index += 1) {
    const step = steps[index]!;
    const next = steps[index + 1];
    if (
      next &&
      step.stepType === "replace" &&
      next.stepType === "replace" &&
      step.from !== undefined &&
      step.to !== undefined &&
      next.from !== undefined &&
      next.to !== undefined &&
      step.from !== step.to &&
      next.from === next.to &&
      (next.from === step.from || next.from === step.to)
    ) {
      merged.push({
        stepType: "replace",
        from: step.from,
        to: step.to,
        slice: next.slice,
      });
      index += 1;
    } else {
      merged.push(step);
    }
  }
  return merged;
}

/** 生成 steps 并校验：把 steps 应用到 before 必须精确得到 after（测试与调试用）。 */
export function diffDocumentsVerified(
  before: JSONContent,
  after: JSONContent,
): StepJson[] {
  const steps = diffDocuments(before, after);
  const schema = sharedSchema();
  const result = applyStepsToDocument(schema, before, steps);
  // 双方都经过 PM 解析再序列化：默认 attrs（如 textAlign: null）的表示归一化。
  const normalizedAfter = ProseMirrorNode.fromJSON(schema, after).toJSON();
  if (JSON.stringify(result) !== JSON.stringify(normalizedAfter)) {
    throw new Error("diff 结果与目标文档不一致，请检查 diff 算法");
  }
  return steps;
}
