import type { Bindings } from "../../src/bindings";
import { createMockAnalytics } from "./mock-analytics";
import { createMockKV } from "./mock-kv";

export interface TestEnvOptions {
  analyticsConfigured?: boolean;
  publicBaseUrl?: string;
  redirectHost?: string;
  apiHost?: string;
  // Optional IdP configuration. Most tests exercise the /api and /mcp
  // handlers directly (bypassing OAuthProvider), so they don't need an IdP
  // configured. Tests that cover /authorize supply their own values.
  idp?: Partial<
    Pick<
      Bindings,
      | "CF_ACCESS_TEAM_DOMAIN"
      | "CF_ACCESS_AUD"
      | "ACCESS_ALLOWED_EMAILS"
      | "OIDC_ISSUER"
      | "OIDC_CLIENT_ID"
      | "OIDC_CLIENT_SECRET"
      | "OIDC_SCOPES"
      | "OIDC_ALLOWED_SUBS"
    >
  >;
}

export function createTestEnv(opts: TestEnvOptions = {}): Bindings {
  const env: Bindings = {
    SHORTLINKS: createMockKV(),
    ANALYTICS: createMockAnalytics(),
    OAUTH_KV: createMockKV(),
  };
  if (opts.analyticsConfigured) {
    env.CF_ACCOUNT_ID = "test-account";
    env.CF_ANALYTICS_TOKEN = "test-analytics-token-abcdef";
  }
  if (opts.publicBaseUrl) env.PUBLIC_BASE_URL = opts.publicBaseUrl;
  if (opts.redirectHost) env.REDIRECT_HOST = opts.redirectHost;
  if (opts.apiHost) env.API_HOST = opts.apiHost;
  if (opts.idp) Object.assign(env, opts.idp);
  return env;
}

export function createTestCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
}
