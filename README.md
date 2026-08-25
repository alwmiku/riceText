# RiceText

RiceText 是面向论坛帖子与小说章节的富文本编辑器/显示器。前端使用 Vite、React、Tiptap 与 shadcn/ui 风格组件，服务端使用 Fastify 与 Node 24 原生 SQLite；项目不依赖 Next.js，以 pnpm monorepo 组织。

## 项目结构

- `apps/web` — Vite + React 编辑器与阅读器（唯一有部署产物的包）
- `apps/api` — Fastify + Node 24 原生 SQLite，在事务内完成 revision 乐观并发写入
- `packages/contracts` — 接口与类型的单一来源：Zod 契约、OpenAPI 生成、类型化客户端
- `packages/document-core` — 无 React 依赖的 Tiptap schema、文档净化、diff 与 steps 应用
- `packages/editor-core` — 带 React NodeView 的 Tiptap 扩展与只读 Viewer

三个 `packages/*` 通过 `exports` 直接导出源码（`src/index.ts`），由 TSX / Vite 直接消费，无需预先构建；`apps/api` 同样以 `tsx` 运行源码。因此 `pnpm build` 只构建 `apps/web` 的部署产物。

## 启动

环境要求：Node.js 24、pnpm 11（版本以根目录 `packageManager` 字段为准）。

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

`pnpm.cmd check` 依次执行 lint、类型检查、测试与构建。E2E 使用 Playwright，首次运行前需执行 `pnpm.cmd exec playwright install chromium`。

## 功能状态

以下能力全部由真实 API 与 SQLite 驱动：文档与不可变版本、图片上传、稳定骰子、间贴回复树与赞踩、章节目录与差异同步、纠错建议、@ 解析、回复可见、附件金币购买与投票。

身份是开发用适配器：请求头 `x-user-id` 选择种子身份（author / reader / moderator），`AuthProvider` 抽象可在生产环境替换为 JWT/SSO。附件账务与投票为单机演示级实现，生产接入前必须替换鉴权、账务与通知服务。

## 数据与安全

正文只持久化白名单 Tiptap JSON；图片二进制不会嵌入正文。文档保存使用递增 revision、`baseRevision` 与 `clientMutationId` 实现乐观并发与幂等写入，不依赖内容 Hash 或静默覆盖；章节差异同步则使用内容哈希做最小上传。客户端与服务端都按 schema 白名单校验/净化 JSON，拒绝未知节点、危险 URL、任意样式与 base64 媒体。

## 接口说明

`packages/contracts` 是接口与类型的单一来源：所有路由、请求/响应 schema 与类型化客户端 `createApiClient` 均由同一份契约生成，`apps/web` 的 API 层直接复用该客户端。执行 `pnpm.cmd --filter @ricetext/contracts openapi` 可重新生成 `docs/openapi.yaml`；生成的 OpenAPI 3.1 包含中文用途、权限、请求/响应字段、状态码与示例，路由通过 `x-implementation-status` 标记 `implemented`（已实现）。

更详细的设计说明见 `docs/ARCHITECTURE.md`。
