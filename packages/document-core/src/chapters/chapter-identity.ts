import { createEntityId, isCurrentEntityId } from "@ricetext/contracts";

/**
 * Mint a stable chapter identity once. Position, title and content never affect the ID.
 */
export function createChapterId(): string {
  return createEntityId("chapter");
}

/** Accept current IDs and historical chapter-prefixed identities already persisted in documents. */
export function isChapterId(value: unknown): value is string {
  return (
    isCurrentEntityId(value, "chapter") ||
    (typeof value === "string" && /^chapter-[A-Za-z0-9-]{1,120}$/u.test(value))
  );
}

/**
 * Determine whether a value can continue to identify an existing chapter. Historical data includes
 * document-scoped and long-text IDs that predate the current prefix convention.
 */
export function isUsableChapterId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /^[A-Za-z0-9][A-Za-z0-9_-]*$/u.test(value)
  );
}
