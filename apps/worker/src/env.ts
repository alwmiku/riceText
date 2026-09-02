/** Worker 运行时绑定；preview/production 必须使用彼此隔离的 D1、R2 与认证配置。 */
export interface WorkerEnv {
  DB: D1Database;
  UPLOADS: R2Bucket;
  ENVIRONMENT: "development" | "preview" | "production";
  ALLOW_DEMO_AUTH: "true" | "false";
  ALLOWED_ORIGINS: string;
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
}

export type WorkerVariables = {
  requestId: string;
};
