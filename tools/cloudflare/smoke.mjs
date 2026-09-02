// 发布后从公网入口验证 Pages/Worker 分流，重点防止 /api 404 被 SPA HTML 吞掉。
const origin = (process.argv.slice(2).find((value) => value !== "--") ?? "").replace(/\/$/, "");
if (!origin) throw new Error("Usage: node tools/cloudflare/smoke.mjs <origin>");

async function expectResponse(path, expectedStatus, assertion) {
  const response = await fetch(origin + path, { redirect: "manual" });
  if (response.status !== expectedStatus) {
    throw new Error(path + " returned " + response.status + ", expected " + expectedStatus);
  }
  await assertion(response);
}
await expectResponse("/", 200, async (response) => {
  if (!response.headers.get("content-type")?.includes("text/html")) {
    throw new Error("Pages root did not return HTML");
  }
});
await expectResponse("/api/health", 200, async (response) => {
  const body = await response.json();
  if (body.ok !== true || body.service !== "ricetext-worker") {
    throw new Error("Worker health payload is invalid");
  }
});
await expectResponse("/api/route-that-does-not-exist", 404, async (response) => {
  if (!response.headers.get("content-type")?.includes("application/json")) {
    throw new Error("API 404 was swallowed by the Pages HTML fallback");
  }
  const body = await response.json();
  if (body.error?.code !== "ROUTE_NOT_FOUND") throw new Error("Unexpected API 404 payload");
});
const unsafe = await fetch(origin + "/api/auth/logout", { method: "POST", redirect: "manual" });
if (unsafe.status !== 403) {
  throw new Error("Production Origin guard is not active; logout returned " + unsafe.status);
}
console.log(JSON.stringify({ origin, smoke: "passed" }, null, 2));
