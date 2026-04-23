import type { Bindings } from "../../src/bindings";
import { createMockAnalytics } from "./mock-analytics";
import { createMockKV } from "./mock-kv";

// Strong enough to clear the auth middleware's minimum-length / blocklist
// check (>= 24 chars, not a known placeholder).
export const TEST_TOKEN = "test-secret-token-abcdef-123456";

export interface TestEnvOptions {
  apiToken?: string;
  analyticsConfigured?: boolean;
}

export function createTestEnv(opts: TestEnvOptions = {}): Bindings {
  const env: Bindings = {
    SHORTLINKS: createMockKV(),
    ANALYTICS: createMockAnalytics(),
    API_TOKEN: opts.apiToken ?? TEST_TOKEN,
  };
  if (opts.analyticsConfigured) {
    env.CF_ACCOUNT_ID = "test-account";
    env.CF_ANALYTICS_TOKEN = TEST_TOKEN;
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

export function authHeader(token = TEST_TOKEN): { Authorization: string } {
  return { Authorization: `Bearer ${token}` };
}
