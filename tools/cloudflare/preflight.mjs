// 部署前硬门禁：占位资源、跨域路由、缺失认证变量或尚未创建的 R2 桶都必须在上传前失败。
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const [target] = process.argv.slice(2).filter((value) => value !== "--");
if (target !== "preview" && target !== "production") {
  throw new Error("Usage: node tools/cloudflare/preflight.mjs <preview|production>");
}
for (const name of [
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "CF_PAGES_PROJECT",
  "CF_APP_ORIGIN",
]) {
  if (!process.env[name]) throw new Error("Missing deployment variable: " + name);
}
const configText = await readFile("apps/worker/wrangler.jsonc", "utf8");
// 当前配置中的注释均独占一行；移除后再交给标准 JSON 解析器，避免误伤 https:// 字符串。
const config = JSON.parse(configText.replace(/^\s*\/\/.*$/gm, ""));
const selected = config.env?.[target];
if (!selected) throw new Error("Missing Wrangler environment: " + target);
const database = selected.d1_databases?.find((item) => item.binding === "DB");
if (!database?.database_id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(database.database_id)) {
  throw new Error("Wrangler " + target + " D1 database_id is still a placeholder");
}
if (selected.vars?.ALLOW_DEMO_AUTH !== "false") {
  throw new Error("ALLOW_DEMO_AUTH must be false outside local development");
}
const origin = selected.vars?.ALLOWED_ORIGINS;
if (!origin || origin.includes("example.com") || origin !== process.env.CF_APP_ORIGIN) {
  throw new Error("ALLOWED_ORIGINS must equal CF_APP_ORIGIN and use the real hostname");
}
const host = new URL(origin).host;
const routes = selected.routes ?? [];
if (!routes.some((route) => route.pattern === host + "/api/*")) {
  throw new Error("Wrangler route must declare " + host + "/api/*");
}
const uploads = selected.r2_buckets?.find((item) => item.binding === "UPLOADS");
if (!uploads) {
  throw new Error("Missing UPLOADS R2 binding for " + target);
}
// 绑定名写对不等于桶真的存在：漏建桶在运行时只会变成 404，而线上取不出表情图时
// 很难第一时间想到是桶没建。列表能拉到时做硬校验；拉不到（网络/凭据）不误判，
// 交给后面的上传步骤去暴露。
const buckets = spawnSync(
  process.execPath,
  [
    "apps/worker/node_modules/wrangler/bin/wrangler.js",
    "r2",
    "bucket",
    "list",
    "--cwd",
    "apps/worker",
  ],
  { encoding: "utf8", shell: false },
);
const bucketList = String(buckets.stdout ?? "") + String(buckets.stderr ?? "");
if (buckets.status === 0 && !bucketList.includes("name:" + " ".repeat(11) + uploads.bucket_name)) {
  throw new Error(
    "R2 bucket " +
      uploads.bucket_name +
      " does not exist in this account; create it with: " +
      "pnpm --filter @ricetext/worker exec wrangler r2 bucket create " +
      uploads.bucket_name,
  );
}
const oidc = [process.env.OIDC_ISSUER, process.env.OIDC_CLIENT_ID, process.env.OIDC_CLIENT_SECRET];
if (oidc.some(Boolean) && !oidc.every(Boolean)) {
  throw new Error("OIDC variables must be configured together or omitted together");
}
if (process.env.OIDC_ISSUER) {
  const issuer = new URL(process.env.OIDC_ISSUER);
  if (issuer.protocol !== "https:") throw new Error("OIDC_ISSUER must use HTTPS");
}
console.log(
  JSON.stringify({ target, origin, database: database.database_name, ready: true }, null, 2),
);
