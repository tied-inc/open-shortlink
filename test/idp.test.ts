import { describe, expect, test } from "bun:test";
import { isAllowed, selectIdpMode } from "../src/oauth/idp";
import { createTestEnv } from "./helpers/test-app";

describe("selectIdpMode", () => {
  test("misconfigured when nothing is set", () => {
    const mode = selectIdpMode(createTestEnv());
    expect(mode.kind).toBe("misconfigured");
    if (mode.kind === "misconfigured") {
      expect(mode.reason).toContain("no identity provider configured");
    }
  });

  test("misconfigured when both Access and OIDC are set", () => {
    const mode = selectIdpMode(
      createTestEnv({
        idp: {
          CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
          CF_ACCESS_AUD: "abc",
          ACCESS_ALLOWED_EMAILS: "a@b.com",
          OIDC_ISSUER: "https://idp.example",
          OIDC_CLIENT_ID: "cid",
          OIDC_CLIENT_SECRET: "csecret",
          OIDC_ALLOWED_SUBS: "a@b.com",
        },
      }),
    );
    expect(mode.kind).toBe("misconfigured");
    if (mode.kind === "misconfigured") {
      expect(mode.reason).toContain("exactly one");
    }
  });

  test("access mode requires team domain + aud + allowlist", () => {
    const noAud = selectIdpMode(
      createTestEnv({
        idp: {
          CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
          ACCESS_ALLOWED_EMAILS: "a@b.com",
        },
      }),
    );
    expect(noAud.kind).toBe("misconfigured");

    const noAllowlist = selectIdpMode(
      createTestEnv({
        idp: {
          CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
          CF_ACCESS_AUD: "abc",
        },
      }),
    );
    expect(noAllowlist.kind).toBe("misconfigured");
    if (noAllowlist.kind === "misconfigured") {
      expect(noAllowlist.reason).toContain("ACCESS_ALLOWED_EMAILS");
    }
  });

  test("access mode: returns configured values", () => {
    const mode = selectIdpMode(
      createTestEnv({
        idp: {
          CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
          CF_ACCESS_AUD: "aud-tag",
          ACCESS_ALLOWED_EMAILS: "A@B.com, c@d.com",
        },
      }),
    );
    expect(mode.kind).toBe("access");
    if (mode.kind === "access") {
      expect(mode.teamDomain).toBe("acme.cloudflareaccess.com");
      expect(mode.aud).toBe("aud-tag");
      // allowlist entries are lowercased and trimmed
      expect(mode.allowedEmails).toEqual(["a@b.com", "c@d.com"]);
    }
  });

  test("oidc mode requires issuer + client_id + client_secret + allowlist", () => {
    const noSecret = selectIdpMode(
      createTestEnv({
        idp: {
          OIDC_ISSUER: "https://idp.example",
          OIDC_CLIENT_ID: "cid",
          OIDC_ALLOWED_SUBS: "a@b.com",
        },
      }),
    );
    expect(noSecret.kind).toBe("misconfigured");

    const noAllowlist = selectIdpMode(
      createTestEnv({
        idp: {
          OIDC_ISSUER: "https://idp.example",
          OIDC_CLIENT_ID: "cid",
          OIDC_CLIENT_SECRET: "csecret",
        },
      }),
    );
    expect(noAllowlist.kind).toBe("misconfigured");
    if (noAllowlist.kind === "misconfigured") {
      expect(noAllowlist.reason).toContain("OIDC_ALLOWED_SUBS");
    }
  });

  test("oidc mode: trims trailing slash from issuer and defaults scopes", () => {
    const mode = selectIdpMode(
      createTestEnv({
        idp: {
          OIDC_ISSUER: "https://idp.example/",
          OIDC_CLIENT_ID: "cid",
          OIDC_CLIENT_SECRET: "csecret",
          OIDC_ALLOWED_SUBS: "a@b.com",
        },
      }),
    );
    expect(mode.kind).toBe("oidc");
    if (mode.kind === "oidc") {
      expect(mode.issuer).toBe("https://idp.example");
      expect(mode.scopes).toBe("openid email profile");
      expect(mode.allowed).toEqual(["a@b.com"]);
    }
  });
});

describe("isAllowed", () => {
  test("access mode matches by email, case-insensitive", () => {
    const mode = selectIdpMode(
      createTestEnv({
        idp: {
          CF_ACCESS_TEAM_DOMAIN: "acme.cloudflareaccess.com",
          CF_ACCESS_AUD: "aud",
          ACCESS_ALLOWED_EMAILS: "alice@example.com",
        },
      }),
    );
    expect(isAllowed(mode, { sub: "x", email: "ALICE@example.com" })).toBe(
      true,
    );
    expect(isAllowed(mode, { sub: "x", email: "bob@example.com" })).toBe(false);
    // Access mode requires email; sub-only match is not accepted.
    expect(isAllowed(mode, { sub: "alice@example.com" })).toBe(false);
  });

  test("oidc mode matches either email or sub", () => {
    const mode = selectIdpMode(
      createTestEnv({
        idp: {
          OIDC_ISSUER: "https://idp.example",
          OIDC_CLIENT_ID: "cid",
          OIDC_CLIENT_SECRET: "csecret",
          OIDC_ALLOWED_SUBS: "alice@example.com, user-12345",
        },
      }),
    );
    expect(isAllowed(mode, { sub: "x", email: "alice@example.com" })).toBe(
      true,
    );
    expect(isAllowed(mode, { sub: "user-12345" })).toBe(true);
    expect(isAllowed(mode, { sub: "x", email: "bob@example.com" })).toBe(false);
  });
});
