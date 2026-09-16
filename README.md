# RiceText

RiceText 是面向论坛帖子与小说章节的富文本编辑器/显示器。前端使用 Vite、React、Tiptap 与 shadcn/ui 风格组件，服务端是 Cloudflare Worker + D1 + R2；项目不依赖 Next.js，以 pnpm monorepo 组织。

生产与本地只有**一套后端**：本地开发同样跑 Wrangler 的 Worker 与本地 D1/R2，不再维护第二套 Node API 实现。

## 项目结构

- `apps/web` — Vite + React 编辑器与阅读器，部署到 Cloudflare Pages
- `apps/worker` — Hono Cloudflare Worker，使用 D1、R2、OIDC 与 Cron；`migrations/` 是数据库 schema 的唯一来源
- `packages/contracts` — 接口与类型的单一来源：Zod 契约、OpenAPI 生成、类型化客户端
- `packages/document-core` — 无 React 依赖的 Tiptap schema、文档净化、diff 与 steps 应用
- `packages/editor-core` — 带 React NodeView 的 Tiptap 扩展与只读 Viewer
- `packages/server-core` — 与后端实现无关的服务端文档、建议与资产规则
- `packages/r2-assets` — 站点表情到 R2 的资源清单、校验和上传工具
- `assets/emoji` — 随仓库提交的站点表情原图与构建期缩略图

工作区包通过 `exports` 直接导出源码，由 TSX、Vite 和 Wrangler 消费。`pnpm build` 同时构建 Pages 前端和执行 Worker 部署 dry-run。

## 启动

环境要求：Node.js 24、pnpm 11（版本以根目录 `packageManager` 字段为准）。

```powershell
pnpm.cmd install
pnpm.cmd dev
```

- 编辑器与演示应用：`http://127.0.0.1:5173`
- API：`http://127.0.0.1:8787/api`
- OpenAPI：`docs/openapi.yaml`

前端通过 Vite 的同源 `/api` 代理访问 Worker，浏览器侧不需要配置 API 地址。
首次运行先给本地 D1 应用 migrations 并写入演示数据（命令幂等，可反复执行）：

```powershell
pnpm.cmd cf:seed:local
```

本地模拟状态位于 `apps/worker/.wrangler/state`（或 `--persist-to` 指定的目录），
不会提交到 Git。演示数据由 `tools/cloudflare/d1-seed.ts` 生成，只写数据、不建表。

## 项目文字规范

项目自有源码的注释、JSDoc 和文档类说明统一使用中文。API、Markdown、Tiptap 等技术术语可以保留英文，但不使用整段英文说明。不为统一语言而修改测试文件、日志、界面或错误提示。代码标识符、协议字段、稳定错误码、命令和路径保持不变；第三方依赖、许可证和生成产物不直接修改，生成文档应从源描述更新。

## 代码格式与 VS Code

Prettier，排版规则以 `.prettierrc.json` 为准：2 个空格缩进、双引号、保留分号、100 列换行参考宽度和 LF 换行符。`.prettierignore` 排除依赖、构建产物、本地数据和生成文件。不要手动格式化 `pnpm-lock.yaml` 或 `docs/openapi.yaml`。

```powershell
pnpm.cmd format:check                         # 检查全仓格式，不改写文件
pnpm.cmd format                               # 按统一规则格式化全仓支持的文件
pnpm.cmd exec prettier --write path/to/file.ts # 仅格式化正在修改的文件
pnpm.cmd lint:fix                             # 执行 ESLint 可自动修复的规则
```

格式工具接入时不批量重排历史源码；存量文件可随编辑逐步整理，`format:check` 会如实报告尚未统一的文件。当前 `pnpm check` 和 CI 保持原有检查范围；全仓格式统一后再加入格式检查。

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

以下能力全部由真实 Worker API 与本地 D1 驱动：文档与不可变版本、图片上传、稳定骰子、间贴回复树与赞踩、章节目录与差异同步、纠错建议、@ 解析、回复可见、附件金币购买与投票。

表情：工具栏/折叠菜单/右键菜单/选区浮动栏都可插入，正文中敲 `hh` 或 `:` 会弹出候选浮层。
Unicode 表情与颜文字存为普通文本；站点自定义表情是行内原子节点 `emoji`，图片由
`GET /api/emoji/:emojiId/image` 提供。

**表情大小就是字号**：表情按 em 渲染（2 倍字号），所以选中文字或把光标放进段落，
用工具栏字号下拉（12–512px 预设）或旁边的输入框直接填数字（例如 `400`）即可缩放，
512px 能拿到约 1024px 的整屏表情。光标状态下的字号会作用到整段。

新增一个站点表情：

1. 把图片放进 `assets/emoji/`（支持 PNG/GIF，沿用原文件名即可）；
2. 在 `packages/contracts/src/emoji-catalog.ts` 的 `CUSTOM_EMOJI_ENTRIES` 里加一条，
   `assetFile` 填文件名，`text` 填图片加载失败时的降级字符；
3. 若是动图，执行一次 `pnpm.cmd run emoji:thumbs` 生成面板用的首帧缩略图并提交。

动图只在正文里播放；面板与候选浮层走 `/api/emoji/:id/image?frame=first` 的静态首帧
（48×48 PNG），避免一次解码十几张 500×500 动图。

`id` 会写进正文与 URL，属于持久化契约：发布后不可改名或复用，下线只会让历史正文降级为
`text` 里的字符。

身份分两套且互不干扰：生产只信任 `GET /api/auth/login` 的 OIDC 登录或密码登录写下的 HttpOnly session cookie；请求头 `x-user-id` 只在 `ALLOW_DEMO_AUTH=true` 时生效，且部署前的 `pnpm cf:preflight` 会拒绝 preview/production 打开该开关。附件账务与投票为演示级实现，生产接入前必须替换账务与通知服务。

## 项目内部复制粘贴

普通富文本编辑区的选区浮动工具栏“复制”与 Ctrl+C 共用剪贴板序列化，同时提供 HTML 和纯文本。项目内部粘贴可保留所选文字、空白、行内格式、段落属性、列表结构和自定义节点的持久化属性。浮动工具栏“粘贴”优先读取 HTML，只有纯文本剪贴板才按文字插入；复制失败会显示提示，不会静默改成纯文本复制。浏览器需要允许剪贴板访问，旧浏览器复制采用原生复制事件回退。

把部分段落粘入空白段落会继承源段落的对齐和缩进；插入已有正文时遵循编辑器的段落合并规则，保留目标段落属性。HTML 粘贴仍受共享 schema 和安全属性规则约束，透明颜色通过经过校验的 HTML 元数据保留。复制图片、投票、间贴等节点会保留已有资源引用，不会新建对应服务器实体，访问权限仍由服务器判断。长文本工作台的章节输入框仍为纯文本；本轮未增加 Word 专用转换。

## 数据与安全

正文只持久化白名单 Tiptap JSON；图片二进制不会嵌入正文。文档保存使用递增 revision、`baseRevision` 与 `clientMutationId` 实现乐观并发与幂等写入，不依赖内容 Hash 或静默覆盖；章节差异同步则使用内容哈希做最小上传。客户端与服务端都按 schema 白名单校验/净化 JSON，拒绝未知节点、危险 URL、任意样式与 base64 媒体。

对外可见、持久化或跨模块流转的业务 ID 统一为 `<类型前缀>_<uuid-v4>`；服务端内部 request ID、锁、认证 state 和会话 token 可保持裸 UUID 或高熵随机值。ID 不编码时间、顺序和父实体，排序与清理只依赖 `created_at`、`updated_at`、`sort_order`、`revision` 等独立字段。历史 ID 不批量重写，新代码写新格式、读取路径继续兼容旧值。

章节身份是 `chapter_<uuid>`，创建时铸造一次，移动、改名、改正文都不变；ID 不含位置，代码不得从它反解章号，位置只由服务端的 `order` 给出。读、存、删、隐藏、换序、批量上传与建议定位一律以 `chapterId` 寻址；换序请求用有序 id 列表表达意图，数组下标即目标顺序。历史 ID（`chapter-<order>`、`chapter-v1-<hash>` 等）不迁移，按不透明身份继续可用。

## 接口说明

`packages/contracts` 是接口与类型的单一来源：所有路由、请求/响应 schema 与类型化客户端 `createApiClient` 均由同一份契约生成，`apps/web` 的 API 层直接复用该客户端。执行 `pnpm.cmd --filter @ricetext/contracts openapi` 可重新生成 `docs/openapi.yaml`；生成的 OpenAPI 3.1 包含中文用途、权限、请求/响应字段、状态码与示例，路由通过 `x-implementation-status` 标记 `implemented`（已实现）。

更详细的设计说明见 `docs/ARCHITECTURE.md`。Cloudflare Pages + Workers + D1 + R2 的资源配置、OIDC 身份映射、数据迁移、自动验证、切流和回滚步骤见 `docs/CLOUDFLARE.md`。
