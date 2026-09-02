import { createWorkerApp } from "./app";
import type { WorkerEnv } from "./env";
import { cleanupExpiredAuth } from "./oidc";
import { cleanupStaleAssets } from "./repositories/asset-repository";

const app = createWorkerApp();

/** Cloudflare 唯一入口：HTTP 交给 Hono，scheduled 仅执行可重入的清理任务。 */
export default {
  fetch(request: Request, env: WorkerEnv, executionContext: ExecutionContext) {
    return app.fetch(request, env, executionContext);
  },
  async scheduled(_controller: ScheduledController, env: WorkerEnv): Promise<void> {
    await Promise.all([
      cleanupStaleAssets(env.DB, env.UPLOADS),
      cleanupExpiredAuth(env.DB),
    ]);
  },
} satisfies ExportedHandler<WorkerEnv>;
