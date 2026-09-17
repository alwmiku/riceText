import { z } from "zod";

/** 业务实体 ID 的唯一前缀注册表；新增类型必须先在此登记。 */
export const ENTITY_ID_PREFIXES = {
  article: "article",
  chapter: "chapter",
  asset: "asset",
  roll: "roll",
  comment: "comment",
  suggestion: "suggestion",
  suggestionBatch: "suggestion_batch",
  upload: "upload",
  gate: "gate",
  poll: "poll",
  pollOption: "poll_option",
  pollVote: "poll_vote",
  attachment: "attachment",
  user: "user",
  mutation: "mutation",
  tag: "tag",
} as const;

/** 已注册的持久化业务实体前缀。 */
export type EntityIdPrefix = (typeof ENTITY_ID_PREFIXES)[keyof typeof ENTITY_ID_PREFIXES];
/** 仅在前端本地存在、不得冒充服务端实体的临时对象类型。 */
export type TemporaryEntityType = "asset" | "roll" | "comment";

/** 小写标准 UUID v4 的主体格式，不包含业务前缀。 */
const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const UUID_V4_PATTERN = new RegExp("^" + UUID_V4_SOURCE + "$", "u");

/** 使用 Web Crypto 生成 UUID v4；不允许退回时间戳或 Math.random。 */
function randomUuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("生成实体 ID 需要 Web Crypto 支持");
  }
  // 非安全上下文可能没有 randomUUID，但 getRandomValues 仍可生成合规的 v4 位布局。
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return (
    hex.slice(0, 4).join("") +
    "-" +
    hex.slice(4, 6).join("") +
    "-" +
    hex.slice(6, 8).join("") +
    "-" +
    hex.slice(8, 10).join("") +
    "-" +
    hex.slice(10, 16).join("")
  );
}

/** 铸造可跨模块流转的业务实体 ID，格式为 `<类型前缀>_<uuid-v4>`。 */
export function createEntityId(prefix: EntityIdPrefix): string {
  return prefix + "_" + randomUuidV4();
}

/** 铸造本地临时 ID，`tmp_` 前缀用于阻止其被误认为已持久化实体。 */
export function createTemporaryId(type: TemporaryEntityType): string {
  return "tmp_" + type + "_" + randomUuidV4();
}

/** 生成某一业务类型的新格式 ID 正则。 */
export function entityIdPattern(prefix: EntityIdPrefix): RegExp {
  return new RegExp("^" + prefix + "_" + UUID_V4_SOURCE + "$", "u");
}

/** 判断值是否为指定业务类型的当前格式 ID；历史兼容由各领域单独处理。 */
export function isCurrentEntityId(value: unknown, prefix: EntityIdPrefix): value is string {
  return typeof value === "string" && entityIdPattern(prefix).test(value);
}

/** 创建指定业务类型的新格式 ID 校验器。 */
export function entityIdSchema(prefix: EntityIdPrefix) {
  return z.string().regex(entityIdPattern(prefix), "ID 必须使用预期的类型前缀和 UUID v4");
}
