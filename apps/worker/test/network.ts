// workerd 测试的 OIDC 网络请求统一由 MSW 接管，避免测试误访问真实身份服务。
import { setupNetwork } from "@msw/cloudflare";

export const network = setupNetwork();
