// 部署前硬门禁：占位资源、跨域路由或缺失认证变量都必须在上传前失败。
import { readFile } from "node:fs/promises";

const target = process.argv[2];
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
const config = JSON.parse(await readFile("apps/worker/wrangler.jsonc", "utf8"));
const selected = config.env?.[target];
if (!selected) throw new Error("Missing Wrangler environment: " + target);
const database = selected.d1_databases?.find((item) => item.binding === "DB");
if (!database?.database_id || /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(database.database_id)) {
  throw new Error("Wrangler " + target + " D1 database_id is still a placeholder");
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
if (!selected.r2_buckets?.some((item) => item.binding === "UPLOADS")) {
  throw new Error("Missing UPLOADS R2 binding for " + target);
}
const oidc = [process.env.OIDC_ISSUER, process.env.OIDC_CLIENT_ID, process.env.OIDC_CLIENT_SECRET];
if (oidc.some(Boolean) && !oidc.every(Boolean)) {
  throw new Error("OIDC variables must be configured together or omitted together");
}
if (process.env.OIDC_ISSUER) {
  const issuer = new URL(process.env.OIDC_ISSUER);
  if (issuer.protocol !== "https:") throw new Error("OIDC_ISSUER must use HTTPS");
}
console.log(JSON.stringify({ target, origin, database: database.database_name, ready: true }, null, 2));
