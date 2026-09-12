import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { FastifyInstance } from "fastify";
import { createApp } from "./app.js";

/** 一个随用随删的测试应用及其数据目录。 */
export interface TestAppHandle {
  app: FastifyInstance;
  directory: string;
}

/** 以临时数据目录创建可 inject 的应用；调用方用 {@link closeTestApp} 释放。 */
export async function createTestApp(options: { seed?: boolean } = {}): Promise<TestAppHandle> {
  const directory = await mkdtemp(join(tmpdir(), "ricetext-test-"));
  const app = await createApp({
    databasePath: join(directory, "test.sqlite"),
    uploadsDirectory: join(directory, "uploads"),
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    logger: false,
  });
  return { app, directory };
}

/**
 * 先关闭应用（释放 SQLite 的 -wal/-shm 句柄）再删除目录，
 * 否则 Windows 上会因文件仍被占用而 EBUSY。
 */
export async function closeTestApp(handle: TestAppHandle): Promise<void> {
  await handle.app.close();
  await rm(handle.directory, { recursive: true, force: true });
}
