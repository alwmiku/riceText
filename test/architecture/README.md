# 定向依赖约束

`eslint.config.js` 启用 `dependency-rules.mjs`，随 `pnpm.cmd lint` 检查实际源码。规则检查直接导入边，包括类型导入、重导出、静态字符串的动态 import、require 和 TypeScript import 类型查询；相对路径、`@/` 与 `@ricetext/` 路径统一后判断。

- compose 的 chapter-upload-domain/checkpoint/plan、long-text-workspace-projections 以及 lib 的 chapter-source/document-content/chapter-query-keys 不得导入 UI、React、editor-core、组件或 hooks。
- document-core 和 server-core 不得导入应用源码、React/editor-core、Node 内建模块或具体后端框架与存储适配器。共享契约、ProseMirror 和 document-core 依赖仍允许。
- 页面负责组合 feature。页面以外只能引用同 feature 内部模块、其他 feature 的根 index 公开入口，或精确基线列出的既有文件依赖。测试文件不获得跨 feature 豁免。

基线只记录具体源文件与具体目标文件，不接受整个目录或 feature 的通配豁免。重构删除依赖时同步删除基线；新增内部依赖应调整到公开入口、共享领域模块或页面组合，不能通过扩张基线解决。

运行架构回归：

```powershell
node --test --test-isolation=none test/architecture/dependency-rules.test.mjs
```

测试通过真实 ESLint 根配置验证正反例、当前源码和基线有效性。使用 Node 内建测试运行器，无需启动 Vite 或 Worker。该命令独立于当前 `pnpm test`；依赖规则本身由已有 lint 命令持续执行。

当前规则不递归计算传递依赖，不替代完整依赖图审计，也不尝试推导运行时计算的动态模块名称。
