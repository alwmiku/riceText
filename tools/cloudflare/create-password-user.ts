import { randomBytes, randomUUID, webcrypto } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { PASSWORD_HASH_ITERATIONS } from "../../packages/contracts/src/schemas.js";

function argument(name: string): string {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  if (!value) throw new Error("缺少参数 " + name);
  return value;
}

function sql(value: string): string {
  return "'" + value.replaceAll("'", "''") + "'";
}

async function hiddenPassword(): Promise<string> {
  if (!process.stdin.isTTY) {
    let value = "";
    for await (const chunk of process.stdin) value += String(chunk);
    return value.trimEnd();
  }
  return new Promise((resolvePassword, reject) => {
    let value = "";
    process.stdout.write("密码（至少 10 位）：");
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error?: Error) => {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.off("data", onData);
      process.stdout.write("\n");
      if (error) reject(error);
      else resolvePassword(value);
    };
    const onData = (chunk: Buffer) => {
      const character = chunk.toString("utf8");
      if (character === "\u0003") return finish(new Error("已取消"));
      if (character === "\r" || character === "\n") return finish();
      if (character === "\u007f" || character === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += character;
    };
    process.stdin.on("data", onData);
  });
}

const local = process.argv.includes("--local");
const environment = local ? "local" : argument("--env");
const username = argument("--username");
const userId = argument("--user-id");
const name = argument("--name");
const role = argument("--role");
if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) throw new Error("账号只能包含字母、数字、点、下划线和短横线");
if (!/^[A-Za-z0-9._-]{1,128}$/.test(userId)) throw new Error("user-id 格式不正确");
if (role !== "author" && role !== "reader" && role !== "moderator") {
  throw new Error("role 必须是 author、reader 或 moderator");
}
const password = await hiddenPassword();
if (password.length < 10 || password.length > 128) throw new Error("密码长度必须为 10 到 128 位");

const iterations = PASSWORD_HASH_ITERATIONS;
const salt = randomBytes(16);
const key = await webcrypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
const bits = await webcrypto.subtle.deriveBits(
  { name: "PBKDF2", hash: "SHA-256", salt, iterations },
  key,
  256,
);
const saltValue = salt.toString("base64url");
const hashValue = Buffer.from(bits).toString("base64url");
const now = new Date().toISOString();
const statements = [
  "INSERT INTO users(id, name, role, is_friend, bio, created_at, updated_at) VALUES (" +
    [sql(userId), sql(name), sql(role), "0", "''", sql(now), sql(now)].join(", ") +
    ") ON CONFLICT(id) DO UPDATE SET name=excluded.name, role=excluded.role, updated_at=excluded.updated_at;",
  "INSERT OR IGNORE INTO wallets(user_id, balance) VALUES (" + sql(userId) + ", 0);",
  // 重设密码时撤销全部旧会话，避免已泄露 Cookie 在新密码生效后继续使用。
  "DELETE FROM auth_sessions WHERE user_id = " + sql(userId) + ";",
  "INSERT INTO password_credentials(user_id, username, salt, password_hash, iterations, failed_attempts, locked_until, updated_at) VALUES (" +
    [sql(userId), sql(username), sql(saltValue), sql(hashValue), String(iterations), "0", "NULL", sql(now)].join(", ") +
    ") ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, salt=excluded.salt, password_hash=excluded.password_hash, iterations=excluded.iterations, failed_attempts=0, locked_until=NULL, updated_at=excluded.updated_at;",
].join("\n");

const directory = resolve(".data", "auth");
const file = resolve(directory, "credential-" + randomUUID() + ".sql");
await mkdir(directory, { recursive: true });
await writeFile(file, statements + "\n", { encoding: "utf8", mode: 0o600 });
try {
  const pnpmCli = process.env.npm_execpath;
  const command = pnpmCli ? process.execPath : process.platform === "win32" ? "pnpm.cmd" : "pnpm";
  const targetArgs = local ? ["--local"] : ["--remote", "--env", environment];
  const args = [
    "--dir",
    "apps/worker",
    "exec",
    "wrangler",
    "d1",
    "execute",
    "DB",
    ...targetArgs,
    "--file",
    file,
  ];
  const result = spawnSync(command, pnpmCli ? [pnpmCli, ...args] : args, {
    stdio: "inherit",
    shell: !pnpmCli && process.platform === "win32",
  });
  if (result.status !== 0) throw new Error("写入 D1 失败，退出码 " + String(result.status));
  console.log("账号已写入 " + environment + "：" + username + " -> " + userId + " (" + role + ")");
} finally {
  await rm(file, { force: true });
}
