import { z } from "zod";

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
} as const;

export type EntityIdPrefix = (typeof ENTITY_ID_PREFIXES)[keyof typeof ENTITY_ID_PREFIXES];
export type TemporaryEntityType = "asset" | "roll" | "comment";

const UUID_V4_SOURCE = "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
export const UUID_V4_PATTERN = new RegExp("^" + UUID_V4_SOURCE + "$", "u");

function randomUuidV4(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Web Crypto is required to create entity IDs");
  }
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

/** Create an opaque, type-identifiable business entity ID. */
export function createEntityId(prefix: EntityIdPrefix): string {
  return prefix + "_" + randomUuidV4();
}

/** Create an ID that must not be mistaken for a persisted server entity. */
export function createTemporaryId(type: TemporaryEntityType): string {
  return "tmp_" + type + "_" + randomUuidV4();
}

export function entityIdPattern(prefix: EntityIdPrefix): RegExp {
  return new RegExp("^" + prefix + "_" + UUID_V4_SOURCE + "$", "u");
}

export function isCurrentEntityId(value: unknown, prefix: EntityIdPrefix): value is string {
  return typeof value === "string" && entityIdPattern(prefix).test(value);
}

export function entityIdSchema(prefix: EntityIdPrefix) {
  return z
    .string()
    .regex(entityIdPattern(prefix), "ID must use the expected type prefix and UUID v4");
}
