import type { RichTextNode } from "./types";

const DATABASE_NAME = "ricetext-local-drafts";
const DATABASE_VERSION = 1;
const STORE_NAME = "long-text";
const writeQueues = new Map<string, Promise<void>>();

function enqueueWrite(key: string, action: () => Promise<void>): Promise<void> {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const queued = previous.catch(() => undefined).then(action);
  writeQueues.set(key, queued);
  void queued
    .finally(() => {
      if (writeQueues.get(key) === queued) writeQueues.delete(key);
    })
    .catch(() => undefined);
  return queued;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("本地草稿存储失败")),
    );
  });
}

function openDraftDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME))
        request.result.createObjectStore(STORE_NAME);
    });
    request.addEventListener("success", () => resolve(request.result));
    request.addEventListener("error", () =>
      reject(request.error ?? new Error("无法打开本地草稿库")),
    );
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => Promise<T>,
): Promise<T> {
  const database = await openDraftDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, mode);
    const result = await action(transaction.objectStore(STORE_NAME));
    await new Promise<void>((resolve, reject) => {
      transaction.addEventListener("complete", () => resolve());
      transaction.addEventListener("abort", () =>
        reject(transaction.error ?? new Error("本地草稿写入失败")),
      );
      transaction.addEventListener("error", () =>
        reject(transaction.error ?? new Error("本地草稿写入失败")),
      );
    });
    return result;
  } finally {
    database.close();
  }
}

/** 读取 IndexedDB 中的长文本工作区数据。 */
export async function loadLongTextValue<T>(key: string): Promise<T | undefined> {
  await writeQueues.get(key)?.catch(() => undefined);
  return withStore("readonly", async (store) => {
    const value = await requestResult(store.get(key));
    return value === undefined ? undefined : (value as T);
  });
}

/** 覆盖写入 IndexedDB 中的长文本工作区数据。 */
export function saveLongTextValue<T>(key: string, value: T): Promise<void> {
  return enqueueWrite(key, () =>
    withStore("readwrite", async (store) => {
      await requestResult(store.put(value, key));
    }),
  );
}

/** 读取浏览器本机的长文本草稿；草稿不会发送到服务器。 */
export function loadLongTextDraft(
  key: string,
): Promise<RichTextNode | undefined> {
  return loadLongTextValue<RichTextNode>(key);
}

/** 持久化浏览器本机的长文本草稿，适用于超过 localStorage 配额的正文。 */
export function saveLongTextDraft(
  key: string,
  content: RichTextNode,
): Promise<void> {
  return saveLongTextValue(key, content);
}

/** 读取导入时的原始全文；用于章节切割的原文对照审计。 */
export function loadLongTextRaw(key: string): Promise<string | undefined> {
  return loadLongTextValue<string>(key);
}

/** 保存导入时的原始全文；仅在重新导入时覆盖。 */
export function saveLongTextRaw(key: string, text: string): Promise<void> {
  return saveLongTextValue(key, text);
}

/** 删除当前文章的长文本草稿或原文快照。 */
export function deleteLongTextValue(key: string): Promise<void> {
  return enqueueWrite(key, () =>
    withStore("readwrite", async (store) => {
      await requestResult(store.delete(key));
    }),
  );
}
