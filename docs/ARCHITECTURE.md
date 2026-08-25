# 架构说明

## 数据流

`apps/web` 通过类型化 API client 读取 `DocumentEnvelope`，交给 `packages/editor-core` 的共享 Tiptap schema。编辑页维护唯一的串行保存队列；显示页使用静态 React renderer，不创建 Tiptap Editor，也不包含工具栏或 `contenteditable`。

保存请求携带当前 `baseRevision` 和唯一 `clientMutationId`。`apps/api` 在事务内验证身份、幂等键与 base revision，再写入新的不可变 revision 并更新文档指针。回滚复制历史正文并创建新 revision，因此历史记录只增不减。

## 内容与业务实体

正文节点只保存稳定实体 ID 和必要显示属性。图片文件、骰子审计、间贴树、投票、附件和用户资料都独立于正文；修改正文不会隐式删除这些业务记录。间贴的“行首/行末”被定义为稳定段落块的首尾，而非随视口变化的视觉换行。

## 首版边界

SQLite 使用 WAL 和外键，适合当前单机首版，不承诺多实例写入扩展。身份通过 `AuthProvider` 抽象，开发环境由 `x-user-id` 选择种子身份。章节建议、@、回复可见、附件和投票保留正式契约，但当前实现用于单机实现，不能替代生产鉴权、账务或通知服务。

## 安全与流量

客户端与服务端都按 schema 白名单处理 JSON，拒绝未知节点、危险 URL、任意样式和 base64 媒体。上传使用 multipart，历史和树列表使用游标分页，搜索请求可取消，保存请求串行化，旧 revision 响应不能覆盖新状态。
