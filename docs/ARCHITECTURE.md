# 架构说明

## 正文与 schema 数据流

`apps/web` 通过类型化 API client 读取契约信封，在 `lib/document-content.ts` 将传输 JSON 转换为编辑器 JSON。共享字段从 contracts 派生，章节写入在 API 边界执行契约校验。`contracts` 拥有传输类型、安全白名单和 OpenAPI 描述，不反向依赖编辑器。

`document-core/createDocumentExtensions()` 是持久化 schema 的唯一基础组合，包含基础扩展、属性默认值、自定义节点与 mark，且不依赖 React。`editor-core` 按扩展名称替换命令增强，再由编辑器与查看器分别附加 React NodeView。查看器实际使用 `useEditor({ editable: false })`，仍创建 Tiptap Editor；它不是静态 React renderer。是否采用静态渲染需单独评估性能与交互兼容。

未知节点和属性仍被拒绝。已有 `longTextBlock.volumeTitle` 明确允许省略；显式值必须为最多 500 字符的字符串。扩展修改需同时满足真实编辑 JSON、净化器与契约的往返测试，不能以通配属性放行解决漂移。

表情分两类，共用同一份目录（`packages/contracts/src/emoji-catalog.ts`，schema 与渲染共享的常量）：纯文本表情（Unicode 字符、颜文字）直接写成普通 `text` 节点，不占用新 schema；站点自定义表情写成行内原子节点 `emoji`（`emojiId` + `name` + 相对 `src` + `fallback`），图片由 `GET /api/emoji/:emojiId/image` 提供，正文不携带二进制。

`src` 是渲染缓存：净化器命中目录时一律用目录派生的 `/api/emoji/<id>/image` 覆盖正文里的值，目录里查不到的 `emojiId` 则保留原值且不报错——表情包条目下线后，历史正文仍能保存与降级渲染。图片是随仓库提交的静态资源（`apps/api/src/assets/emoji/`，沿用表情包原文件名，可含动图），由目录条目的 `assetFile` 显式指向而不是从 `id` 推导：站点表情包用中文文件名，而 `id` 要留给 URL 与持久化契约。

表情包是**站点内置的只读资源**：没有用户上传、后台管理与自定义分组，新增表情需要同时提交图片资源与目录条目。`emojiId` 属于持久化契约，发布后不可改名或复用；动图只在正文里播放，面板与候选浮层用构建期生成的首帧缩略图，避免一次解码十几张 500×500 动图。

表情**不单独存尺寸**：节点只保留 `emojiId` + `name` + `src` + `fallback`，图片按 `2em` 渲染，大小完全跟随正文字号（`textStyle.fontSize`，白名单 12–512px）。这样「字号」是唯一的大小控制，作者想放大表情只需调字号；曾经存在过的 `size` 属性由净化器静默丢弃，避免旧正文被误判为未知属性。

## 编辑会话与本地草稿

普通正文由 `useComposeDocument` 持有 content、编辑 generation 和服务器元数据，`useAutosave` 持有确认后的正文/revision 基线。静默 1.2 秒后只写本机普通草稿，显式保存才上传 steps。网络保存保持串行；发送前先保留本地快照，确认后的较新编辑继续留在草稿。异步操作捕获文档会话和基线代次，切换文章或替换基线后，旧结果不能更新新会话。

`useLongTextWorkspace` 独立持有整本长文本正文、单章缓冲、原文快照和草稿保存代次。打开与关闭不替换普通正文，也不控制普通 autosave。`captureUploadSnapshot()` 内部冲刷单章缓冲，同时捕获正文与覆盖率。`close()` 冲刷并等待草稿写入；失败保留工作台。文档切换使异步恢复、导入和防抖缓冲失效。两类草稿使用不同存储键。

上传动作和状态由 `chapter-upload-domain.ts` 定义稳定代码；Dialog 只映射中文。计划转换、哈希和差异计算在 `chapter-upload-plan.ts`，批次大小与重试分类沿用 `chapter-upload-batches.ts`，React 生命周期及网络执行仍在 Hook 中。`chapter-upload-checkpoint.ts` 独立编解码 v6 元数据检查点，不保存正文或继承 UI props。正常 v5 中文枚举明确迁移；未知版本或损坏数据仅清理上传检查点并提示重新准备，保留正文草稿。全部暂存仍需完成原子发布，不能仅按上传计数判定发布成功。

## 章节身份与来源

`lib/chapter-source.ts` 为编辑与阅读共享纯解析规则，区分独立章节正文、文档内派生章节、无正文占位、加载中和失败。服务器实体由 `(documentId, chapterId)` 标识；位置只用于排序和已确认的历史正文映射。显式 longTextBlock ID 不按位置回退。`hasContent: true` 的 v0 章节也有正文，`false` 明确表示不能请求独立正文；未提供标记的旧接口才以 revision 兼容判断。

编辑页优先自身尚未保存的文档正文，阅读页优先已确认的独立正文；权限和可编辑性仍由页面处理。独立正文请求失败不能退回同位置的其他章节。目录与正文查询统一使用 `chapter-query-keys.ts`；选中章节按实体保持，旧数字位置存储保留兼容。

## 双后端与提交边界

Node 使用 SQLite（WAL、外键），Worker 使用 D1 batch；身份和资源访问以及数据库事务由各自适配器负责。`server-core` 共享纯规则：章节上传清单的规范化与稳定序列化、暂存版本决策、建议定位与净化。它不提供通用 Repository。

steps 保存顺序为鉴权和请求结构校验、幂等结果查询、基线校验、应用 steps、原子提交。Node 将正文计算延迟到 `BEGIN IMMEDIATE` 事务内；Worker 在应用前查询幂等结果并验证读取的基线，提交层仍保留冲突与重复请求保护。成功请求重试返回原 revision，回滚复制历史正文并创建新 revision，历史记录只增不减。

章节整套发布在 Node 写事务内读取并校验会话和版本；D1 最终同一批次先执行数据库 guard，再替换章节并写入发布回执。整套章节 generation 保护更新、新增和清单遗漏而将被删除的章节；逐章 revision 继续校验。发布占用为 uploading 会话上的 60 秒令牌，aborted 仅表示暂停；过期占用可恢复，旧请求只能释放自己的令牌。暂存触发器禁止占用期间改变清单。

数据库变更只追加 Node V15 与 Worker `0011_chapter_publish_guards.sql`。旧已发布回执保持可重放；旧未完成会话因没有整套 generation 基线，保留暂存数据但必须新建会话重新暂存，不能直接发布。HTTP 路由、既有章节 ID、历史 revision 及清单哈希序列化顺序保持兼容。

单条建议由后端使用建议所属 documentId 和 chapterId 查询真实章节范围，结合行号及完整行上下文唯一定位。旧建议缺定位时仅接受全文唯一匹配。找不到或歧义分别返回 409 `SUGGESTION_SOURCE_NOT_FOUND` / `SUGGESTION_SOURCE_AMBIGUOUS`，失败不写正文或审批状态。当前单条审批仍通过文档 revision 写入；独立章节快照与文档范围不一致（包括空壳文档）时明确拒绝，避免写错正文。独立正文的完整批次校订工作流需要单独演进。

## 扩展能力与修订区域

每个扩展通过自己的 config 声明能力（`capabilities`）。`document-core` 的 `extensionCapabilities` 用 `extendNodeSchema`/`extendMarkSchema` 把声明注入对应 ProseMirror 规格，因此规范扩展与 `additionalExtensions` 注册的第三方扩展被同等对待。新增一种能力时在 `ExtensionCapabilities` 追加字段并提供读取辅助函数，消费方按能力名读取，不为具体扩展名写分支。

「哪些渲染区域可以修订」是第一项能力（`revision`）：`prose` 表示持久化为 text 节点的正文，`chrome` 表示节点属性或视图装饰派生的文本。节点无需提供选择器，`applyRevisionSurfaces` 按 `viewer.nodeDOM` 逐个打点 `data-rt-revise`；标记没有独立节点 DOM，必须自带 `domSelector`；`proseWhen` 表达条件区域（未展开的黑幕）。未声明的原子节点默认装饰，其余默认正文，因此漏声明只会退化到既有行为，不会误放行属性文本。

`resolveRevisionRegion` 是唯一消费者：沿祖先链取**最近**信号（扩展声明优先于平台控件规则，默认正文），返回文本、行号与行文本，不依赖扩展名或 class。声明为 `chrome` 的容器要求整棵子树都是装饰；容器节点应保持 `prose`，只标记自己的装饰子区域——摘录页眉、页脚与书名由 `readerTop`/`readerBottom` 用 `chromeSurface()` 标记，renderHTML 与 React NodeView 两条路径共用同一份声明。

服务端 `applySuggestionText` 仍只按 text 节点定位，装饰文本天然不会被写入正文。新增扩展只要正确声明修订面，读者修订与剪贴板纯文本投影（`text.leafText`）都无需修改共享代码。

## 业务实体与依赖约束

正文节点保存稳定实体 ID 和必要显示属性。图片、骰子审计、间贴树、投票、附件和用户资料独立于正文；正文修改不隐式删除这些实体。间贴的行首/行末指稳定段落块，不是随视口变化的视觉换行。

`eslint.config.js` 接入定向依赖规则：纯领域模块不能直接依赖 UI；document-core/server-core 不能依赖 Web、React 或具体后端；页面外跨 feature 内部依赖仅保留精确文件对基线。规则随现有 lint 在 CI 执行，维护方式和直接依赖检查的边界见 `test/architecture/README.md`。禁止为新增越界依赖扩大目录级豁免。

回归按行为覆盖 Node 与 D1，schema 往返、普通与长文真实 Hook 协作、检查点迁移、暂停恢复、413 拆批、迟到响应、v0/占位/隐藏章节和重复文字定位。架构规则另有 Node 内建测试。各批通过相关回归后执行 `pnpm check` 与受影响 Playwright；源码检查通过不能代替运行时与真实 D1 验证。
