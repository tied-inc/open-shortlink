import type { Bindings } from "../../src/bindings";
import { createMockAnalytics } from "./mock-analytics";
import { createMockKV } from "./mock-kv";

export interface TestEnvOptions {
  apiToken?: string;
  analyticsConfigured?: boolean;
}

export function createTestEnv(opts: TestEnvOptions = {}): Bindings {
  const env: Bindings = {
    SHORTLINKS: createMockKV(),
    ANALYTICS: createMockAnalytics(),
    API_TOKEN: opts.apiToken ?? "test-token",
  };
  if (opts.analyticsConfigured) {
    env.CF_ACCOUNT_ID = "test-account";
    env.CF_ANALYTICS_TOKEN = "test-token";
  }
  return env;
}

export function createTestCtx(): ExecutionContext {
  return {
    waitUntil: () => {},
    passThroughOnException: () => {},
    props: {},
  } as unknown as ExecutionContext;
}

export function authHeader(token = "test-token"): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
