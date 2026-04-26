import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { handleAuthorize, handleOauthCallback } from "../src/oauth/authorize";
import { createTestEnv } from "./helpers/test-app";

// Minimal OAuthProvider stub. The misconfiguration path returns 503 BEFORE
// touching the provider, so these stubs are only here to satisfy the type
// signature.
const noopProvider = {
  parseAuthRequest: async () => {
    throw new Error("provider should not be called in fail-closed tests");
  },
  lookupClient: async () => null,
  completeAuthorization: async () => ({ redirectTo: "https://unused" }),
} as any;

function buildEnv(idp: Parameters<typeof createTestEnv>[0] = {}) {
  return {
    ...createTestEnv(idp),
    OAUTH_PROVIDER: noopProvider,
  };
}

describe("/authorize fail-closed", () => {
  test("returns 503 when no IdP is configured", async () => {
    const env = buildEnv();
    const res = await handleAuthorize(
      new Request("https://example/authorize?response_type=code"),
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; description: string };
    expect(body.error).toBe("server misconfigured");
    expect(body.description).toContain("no identity provider configured");
  });

  test("returns 503 when both Access and OIDC are configured", async () => {
    const env = buildEnv({
      idp: {
        CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
        CF_ACCESS_AUD: "aud",
        ACCESS_ALLOWED_EMAILS: "alice@example.com",
        OIDC_ISSUER: "https://idp.example",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "csecret",
        OIDC_ALLOWED_SUBS: "alice@example.com",
      },
    });
    const res = await handleAuthorize(
      new Request("https://example/authorize?response_type=code"),
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { description: string };
    expect(body.description).toContain("exactly one");
  });

  test("Access mode with empty allowlist is fail-closed", async () => {
    const env = buildEnv({
      idp: {
        CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
        CF_ACCESS_AUD: "aud",
        // ACCESS_ALLOWED_EMAILS deliberately omitted
      },
    });
    const res = await handleAuthorize(
      new Request("https://example/authorize"),
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { description: string };
    expect(body.description).toContain("ACCESS_ALLOWED_EMAILS");
  });
});

describe("/oauth/callback", () => {
  test("returns 404 when OIDC is not configured (Access mode)", async () => {
    const env = buildEnv({
      idp: {
        CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
        CF_ACCESS_AUD: "aud",
        ACCESS_ALLOWED_EMAILS: "alice@example.com",
      },
    });
    const res = await handleOauthCallback(
      new Request("https://example/oauth/callback?code=x&state=y"),
      env,
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { description: string };
    expect(body.description).toContain("OIDC mode is not configured");
  });

  test("returns 503 (not 404) when both IdPs are simultaneously configured", async () => {
    // The previous implementation collapsed misconfigured into the
    // "OIDC not configured" branch and returned a misleading 404. The
    // operator must see the same fail-closed 503 they'd get from
    // /authorize, with the actual reason in the body.
    const env = buildEnv({
      idp: {
        CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
        CF_ACCESS_AUD: "aud",
        ACCESS_ALLOWED_EMAILS: "alice@example.com",
        OIDC_ISSUER: "https://idp.example",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "csecret",
        OIDC_ALLOWED_SUBS: "alice@example.com",
      },
    });
    const res = await handleOauthCallback(
      new Request("https://example/oauth/callback?code=x&state=y"),
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      error: string;
      description: string;
    };
    expect(body.error).toBe("server misconfigured");
    expect(body.description).toContain("exactly one");
  });

  test("returns 503 when no IdP is configured at all", async () => {
    const env = buildEnv();
    const res = await handleOauthCallback(
      new Request("https://example/oauth/callback?code=x&state=y"),
      env,
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("server misconfigured");
  });

  test("returns 400 when state is unknown (OIDC mode)", async () => {
    const env = buildEnv({
      idp: {
        OIDC_ISSUER: "https://idp.example",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "csecret",
        OIDC_ALLOWED_SUBS: "alice@example.com",
      },
    });
    const res = await handleOauthCallback(
      new Request(
        "https://example/oauth/callback?code=abc&state=never-saved",
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("unknown state");
  });

  test("relays upstream error parameter", async () => {
    const env = buildEnv({
      idp: {
        OIDC_ISSUER: "https://idp.example",
        OIDC_CLIENT_ID: "cid",
        OIDC_CLIENT_SECRET: "csecret",
        OIDC_ALLOWED_SUBS: "alice@example.com",
      },
    });
    const res = await handleOauthCallback(
      new Request(
        "https://example/oauth/callback?error=access_denied&error_description=user+declined",
      ),
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("access_denied");
  });
});

// fetch stubbing infrastructure for the discovery-failure tests below.
const originalFetch = globalThis.fetch;
function stubFetch(handler: (input: Request | string | URL) => Response) {
  globalThis.fetch = (async (input: Request | string | URL) =>
    handler(input)) as typeof fetch;
}
function restoreFetch() {
  globalThis.fetch = originalFetch;
}

describe("upstream discovery failure", () => {
  // OIDC mode requires a non-trivial OAuthProvider stub to reach the
  // discovery call. We let parseAuthRequest succeed with a minimal request
  // and have lookupClient return a placeholder client.
  const oidcProvider = {
    parseAuthRequest: async (_req: Request) => ({
      responseType: "code",
      clientId: "downstream-client",
      redirectUri: "https://client.example/cb",
      scope: ["mcp"],
      state: "downstream-state",
    }),
    lookupClient: async (_id: string) => ({
      clientId: "downstream-client",
      redirectUris: ["https://client.example/cb"],
      tokenEndpointAuthMethod: "none",
    }),
    completeAuthorization: async () => ({ redirectTo: "https://unused" }),
  } as any;

  const oidcIdp = {
    OIDC_ISSUER: "https://idp.example",
    OIDC_CLIENT_ID: "cid",
    OIDC_CLIENT_SECRET: "csecret",
    OIDC_ALLOWED_SUBS: "alice@example.com",
  } as const;

  beforeEach(() => {
    // Every discovery URL returns 503 — fetchDiscovery should throw, and the
    // handlers must translate it into a clear 502 instead of letting it
    // bubble up as a generic 500.
    stubFetch(() => new Response("upstream is down", { status: 503 }));
  });
  afterEach(() => {
    restoreFetch();
  });

  test("/authorize returns 502 when discovery fetch fails (OIDC mode)", async () => {
    const env = {
      ...createTestEnv({ idp: oidcIdp }),
      OAUTH_PROVIDER: oidcProvider,
    };
    const res = await handleAuthorize(
      new Request(
        "https://example/authorize?response_type=code&client_id=downstream-client",
      ),
      env,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; description: string };
    expect(body.error).toBe("upstream discovery failed");
    expect(body.description).toContain("OIDC discovery");
  });

  test("/oauth/callback returns 502 when discovery fetch fails (OIDC mode)", async () => {
    const env = {
      ...createTestEnv({ idp: oidcIdp }),
      OAUTH_PROVIDER: oidcProvider,
    };
    // Seed a pending auth so the handler proceeds past the state lookup
    // and into the discovery branch we want to exercise.
    const pending = {
      oauthReq: {
        responseType: "code",
        clientId: "downstream-client",
        redirectUri: "https://client.example/cb",
        scope: ["mcp"],
        state: "downstream-state",
      },
      pkceVerifier: "v".repeat(43),
      nonce: "nonce-value",
      redirectUri: "https://example/oauth/callback",
      issuer: oidcIdp.OIDC_ISSUER,
    };
    await env.OAUTH_KV.put(
      "upstream_oidc_state:state-abc",
      JSON.stringify(pending),
      { expirationTtl: 600 },
    );

    const res = await handleOauthCallback(
      new Request(
        "https://example/oauth/callback?code=upstream-code&state=state-abc",
      ),
      env,
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("upstream discovery failed");
  });
});
