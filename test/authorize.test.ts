import { describe, expect, test } from "bun:test";
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
  test("returns 404 when OIDC is not configured", async () => {
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
