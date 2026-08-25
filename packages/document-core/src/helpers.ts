/** 解析 HTML 属性为限定范围的整数，失败时返回 fallback。 */
export function parseInteger(
  value: string | null,
  fallback: number | null,
  min: number,
  max: number,
): number | null {
  const numeric = value === null ? Number.NaN : Number.parseInt(value, 10);
  return Number.isFinite(numeric)
    ? Math.min(max, Math.max(min, numeric))
    : fallback;
}

/** 解析 JSON 字符串属性，非法或非数组时返回空数组。 */
export function parseJsonArray(value: string | null): unknown[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
