# Cloudflare 测试部署

本项目使用：

- Pages：前端
- Worker：`/api/*`
- D1：业务数据和登录账号
- R2：图片与附件

生产地址：`https://editor.bianbai.org`。

## 本地运行

```bash
pnpm cf:e2e:prepare
pnpm --filter @ricetext/worker dev
```

创建本地测试账号：

```bash
pnpm auth:create-user -- --local --username writer --user-id author --name "作者" --role author
```

另开终端，以账号登录模式启动前端：

```powershell
pnpm --filter @ricetext/web dev:session
```

本地请求通过 Vite 的同源 `/api` 代理访问 Worker，不需要设置 `VITE_API_ROOT`.

## Cloudflare 资源

`apps/worker/wrangler.jsonc` 中使用：

- D1：`ricetext-production`
- R2：`ricetext-production-uploads`
- API 路由：`editor.bianbai.org/api/*`


## 部署 Worker

Cloudflare 部署命令：

```bash
pnpm --filter @ricetext/worker run d1:migrate:production && pnpm --filter @ricetext/worker run deploy
```

部署后检查：

```text
https://editor.bianbai.org/api/health
```

应返回 `service: ricetext-worker` 和 `environment: production`。

## 创建登录账号

先确保最新 D1 migration 已部署，然后在已登录 Wrangler 的本地终端执行。命令会隐藏密码输入，D1 只保存密码哈希。

```bash
pnpm auth:create-user -- --env production --username writer --user-id author --name "作者" --role author
```

重复执行同一个 `user-id` 可重设密码并撤销该用户的旧会话。密码至少 10 位；同一来源 15 分钟内最多尝试登录 10 次。Cloudflare 生产运行时限制 PBKDF2 为 100,000 次，旧的 120,000 次测试凭据必须重新执行建号命令。

OIDC 是可选功能，不使用时无需配置 `OIDC_ISSUER`、`OIDC_CLIENT_ID` 和 `OIDC_CLIENT_SECRET`。

## 重置测试文章数据

章节主键或测试导入数据需要从零验证时，只重置文章域并保留账号、认证和钱包：

```bash
pnpm db:reset-articles -- --env production --confirm ricetext-production
```

本地 Node API 使用 `--sqlite .data/ricetext.sqlite --confirm ricetext-development`；本地 D1 使用 `--local --confirm ricetext-development`。命令会删除文章、章节、修订、校订和评论，并在结束后检查文章计数与数据库外键；不会删除用户、登录凭据、身份映射、钱包、附件或投票资源。

检查本地 Node API 的章节主键、数量和顺序连续性：

```bash
pnpm db:inspect-chapters
pnpm db:inspect-chapters -- --document <文章ID> --from 50 --limit 30
```

## 可选数据导入

需要把旧 SQLite 数据导入 D1 时：

```bash
pnpm cf:export -- --db .data/ricetext.sqlite --uploads .data/uploads --out .data/cloudflare-export
pnpm --filter @ricetext/worker exec wrangler d1 execute DB --remote --env production --file ../../.data/cloudflare-export/d1-import.sql
```

测试项目没有旧数据时可跳过这一节。
