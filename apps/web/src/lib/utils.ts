import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** 合并条件 className，并解决 Tailwind 同类规则冲突。 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** 把日期格式化为当前中文环境下的月/日与时:分。 */
export function formatTime(value: string | number | Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(value instanceof Date ? value : new Date(value));
}

/** 生成带业务前缀的客户端 mutation/临时实体 ID。 */
export function createId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * 铸造章节身份；与领域层的 `createChapterId` 同一形态（`chapter-<uuid>`）。
 *
 * 这里保留一份等价实现，是为了让不依赖 document-core 的纯 Web 工具（例如本地草稿
 * 列表）也能铸造身份；两者的形态由 packages/document-core 的测试固定。
 */
export function createChapterId(): string {
  const uuid =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Math.random().toString(16).slice(2, 10) +
        "-" +
        Math.random().toString(16).slice(2, 6) +
        "-4" +
        Math.random().toString(16).slice(2, 5) +
        "-" +
        Math.random().toString(16).slice(2, 6) +
        "-" +
        Math.random().toString(16).slice(2, 14);
  return "chapter-" + uuid;
}

/** 计算文本的 SHA-256 十六进制摘要，用于章节内容差异对比。 */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
