import type { ForumSuggestion } from "../../lib/api";

/**
 * 校订对比的最小单元是“字”而不是 git 的“行”：
 * 这里的 diff 在单个字符/词粒度上工作，行内只高亮真正变化的部分，
 * 未变化文字与变化片段在同一行内混排。
 */

export type CharDiffOp =
  | { type: "equal"; text: string }
  | { type: "delete"; text: string }
  | { type: "insert"; text: string };

/** 按“字”切分：连续字母/数字视为一个词，中文与符号逐字。 */
export function splitChars(text: string): string[] {
  return text.match(/[A-Za-z0-9]+|./g) ?? [];
}

/**
 * 字级 LCS diff：返回 equal/delete/insert 操作序列。
 * 只适用于单行文本（行内字数有限，O(n*m) 可接受），
 * 因此不会出现行级 diff 那种整行替换的粗粒度。
 */
export function diffChars(before: string, after: string): CharDiffOp[] {
  const a = splitChars(before);
  const b = splitChars(after);
  const n = a.length;
  const m = b.length;
  // lcs[i][j] = a[i..] 与 b[j..] 的最长公共子序列长度
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i] === b[j]
          ? (lcs[i + 1]![j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0);
    }
  }

  const ops: CharDiffOp[] = [];
  const push = (type: CharDiffOp["type"], text: string) => {
    if (!text) return;
    const last = ops[ops.length - 1];
    if (last && last.type === type) last.text += text;
    else ops.push({ type, text });
  };

  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]!);
      i += 1;
      j += 1;
    } else if ((lcs[i + 1]?.[j] ?? 0) >= (lcs[i]?.[j + 1] ?? 0)) {
      push("delete", a[i]!);
      i += 1;
    } else {
      push("insert", b[j]!);
      j += 1;
    }
  }
  while (i < n) {
    push("delete", a[i]!);
    i += 1;
  }
  while (j < m) {
    push("insert", b[j]!);
    j += 1;
  }
  return ops;
}

/**
 * 把一行内的校订逐条应用到该行（每条只替换第一次出现，与服务端
 * replaceFirstText 语义一致），得到校订后的目标行。
 */
export function applySuggestionsToLine(
  lineText: string,
  suggestions: readonly ForumSuggestion[],
): string {
  let result = lineText;
  for (const suggestion of suggestions) {
    if (!suggestion.fromText) continue;
    const index = result.indexOf(suggestion.fromText);
    if (index < 0) continue;
    result =
      result.slice(0, index) +
      suggestion.toText +
      result.slice(index + suggestion.fromText.length);
  }
  return result;
}
