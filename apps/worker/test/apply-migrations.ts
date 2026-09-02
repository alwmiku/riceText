// 测试启动时按正式顺序应用全部 D1 migration，禁止使用手写的简化测试 schema。
import { env } from "cloudflare:workers";
import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import { network } from "./network";
import type { WorkerEnv } from "../src/env";

declare module "cloudflare:workers" {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Cloudflare types use namespace augmentation.
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }
  }
}

beforeAll(() => network.enable());
afterEach(() => network.resetHandlers());
afterAll(() => network.disable());

beforeEach(async () => {
  await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
