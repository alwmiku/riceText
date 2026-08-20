import { resolve } from "node:path";
import { createApp } from "./app.js";

// 使用模块位置而不是 process.cwd()，保证从 workspace 根或包目录启动都写入同一 .data。
const dataDirectory = resolve(import.meta.dirname, "../../..", process.env.RICETEXT_DATA_DIR ?? ".data");
const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "127.0.0.1";

const app = await createApp({
  databasePath: resolve(dataDirectory, "ricetext.sqlite"),
  uploadsDirectory: resolve(dataDirectory, "uploads"),
  logger: true,
});

// 默认仅监听本机；部署环境必须通过 HOST/PORT 明确扩大可访问范围。
await app.listen({ port, host });
