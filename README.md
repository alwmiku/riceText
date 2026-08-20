# RiceText

RiceText 是面向论坛帖子与小说章节的独立富文本编辑器/显示器首版。前端使用 Vite、React、Tiptap 与 shadcn/ui 风格组件，服务端使用 Fastify 和 Node 24 原生 SQLite；项目不依赖 Next.js。

## 启动

环境要求：Node.js 24、pnpm 9。

```powershell
pnpm.cmd install
pnpm.cmd dev
```

- 编辑器与演示应用：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787/api`
- OpenAPI：`docs/openapi.yaml`

首次启动会在 `.data/` 创建 SQLite 数据库和上传目录，并写入演示文档、间贴与作者/读者/版主身份。该目录不会提交到 Git。

## 质量命令

```powershell
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd test
pnpm.cmd test:coverage
pnpm.cmd build
pnpm.cmd test:e2e
```

`pnpm.cmd check` 依次执行 lint、类型检查、测试与构建。

## 实现边界

文档与不可变版本、图片上传、稳定骰子、间贴回复树和赞踩由真实 API 与 SQLite 驱动。章节纠错、@、回复可见、附件金币和投票使用与未来 API 相同的契约演示完整状态流，界面会标明“演示数据”。生产接入前必须替换演示身份与这些 mock 领域实现。

正文只持久化白名单 Tiptap JSON；图片二进制不会嵌入正文。所有更新使用递增 revision、`baseRevision` 和 `clientMutationId`，不使用内容 Hash 或静默覆盖。

## 接口说明

`packages/contracts` 是接口与类型的单一来源。所有公共 schema、组件属性和 adapter 都有 TSDoc；生成的 OpenAPI 3.1 包含中文用途、权限、请求/响应字段、状态码和示例，演示接口带 `x-implementation-status: mock`。
