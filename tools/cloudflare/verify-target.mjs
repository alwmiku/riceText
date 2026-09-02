// 切流前比较源报告与远端 D1/R2，并验证外键、ACL、身份和购买触发器。
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const target = process.argv[2];
const directory = resolve(process.argv[3] ?? ".data/cloudflare-export");
if (target !== "preview" && target !== "production") {
  throw new Error("Usage: node tools/cloudflare/verify-target.mjs <preview|production> [export-dir]");
}
const source = JSON.parse(await readFile(resolve(directory, "verification-source.json"), "utf8"));
const manifest = JSON.parse(await readFile(resolve(directory, "r2-manifest.json"), "utf8"));
const r2 = JSON.parse(await readFile(resolve(directory, "verification-r2-target.json"), "utf8"));
const tables = Object.keys(source.counts);
if (tables.some((table) => !/^[a-z_]+$/.test(table))) throw new Error("Unsafe table name in source report");
const countSql = tables
  .map((table) => "SELECT '" + table + "' AS table_name, COUNT(*) AS row_count FROM " + table)
  .join(" UNION ALL ");
const invariantSql = [
  "SELECT 'foreign_keys' AS check_name, COUNT(*) AS failures FROM pragma_foreign_key_check",
  "UNION ALL SELECT 'current_revisions', COUNT(*) FROM documents d LEFT JOIN document_revisions r ON r.document_id=d.id AND r.revision=d.current_revision WHERE r.revision IS NULL",
  "UNION ALL SELECT 'owner_acl', COUNT(*) FROM documents d LEFT JOIN document_acl a ON a.document_id=d.id AND a.user_id=d.created_by AND a.permission='admin' WHERE a.user_id IS NULL",
  "UNION ALL SELECT 'privileged_auth', COUNT(*) FROM (SELECT id AS user_id FROM users WHERE role IN ('author','moderator') UNION SELECT created_by FROM documents UNION SELECT user_id FROM document_acl WHERE permission IN ('edit','admin')) privileged LEFT JOIN auth_identities i ON i.user_id=privileged.user_id LEFT JOIN password_credentials p ON p.user_id=privileged.user_id WHERE i.user_id IS NULL AND p.user_id IS NULL",
  "UNION ALL SELECT 'required_triggers', 2-COUNT(*) FROM sqlite_schema WHERE type='trigger' AND name IN ('attachment_purchase_checks_balance','attachment_purchase_moves_balance')",
].join(" ");

function execute(sql) {
  const pnpmCli = process.env.npm_execpath;
  const command = pnpmCli ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const args = ["--dir", "apps/worker", "exec", "wrangler", "d1", "execute", "DB", "--remote", "--env", target, "--command", sql, "--json"];
  const result = spawnSync(command, pnpmCli ? [pnpmCli, ...args] : args, {
    encoding: "utf8",
    shell: !pnpmCli && process.platform === "win32",
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout || "D1 verification failed");
  const payload = JSON.parse(result.stdout);
  return payload[0]?.results ?? payload.results ?? [];
}
const countRows = execute(countSql);
for (const row of countRows) {
  const expected = source.counts[row.table_name];
  if (Number(row.row_count) !== Number(expected)) {
    throw new Error(row.table_name + " count mismatch: expected " + expected + ", got " + row.row_count);
  }
}
if (countRows.length !== tables.length) throw new Error("D1 count verification returned incomplete results");
for (const row of execute(invariantSql)) {
  if (Number(row.failures) !== 0) throw new Error("D1 invariant failed: " + row.check_name + "=" + row.failures);
}
const expectedObjects = manifest.items.filter((item) => item.state === "ready").length;
if (r2.verified !== expectedObjects || r2.uploaded !== expectedObjects) {
  throw new Error("R2 verification report does not cover every manifest object");
}
console.log(JSON.stringify({ target, tables: tables.length, r2Objects: expectedObjects, verified: true }, null, 2));
