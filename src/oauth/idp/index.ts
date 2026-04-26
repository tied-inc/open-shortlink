import type { Bindings } from "../../bindings";

// The upstream identity this Worker will trust when authorizing MCP / API
// clients. Exactly one mode may be configured; if zero or two are configured
// the selector returns "misconfigured" and /authorize fails closed.
export type IdpMode =
  | {
      kind: "access";
      teamDomain: string;
      aud: string;
      allowedEmails: string[];
    }
  | {
      kind: "oidc";
      issuer: string;
      clientId: string;
      clientSecret: string;
      scopes: string;
      allowed: string[];
    }
  | { kind: "misconfigured"; reason: string };

function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((v) => v.trim().toLowerCase())
    .filter((v) => v.length > 0);
}

export function selectIdpMode(env: Bindings): IdpMode {
  const accessConfigured = Boolean(env.CF_ACCESS_TEAM_DOMAIN || env.CF_ACCESS_AUD);
  const oidcConfigured = Boolean(
    env.OIDC_ISSUER || env.OIDC_CLIENT_ID || env.OIDC_CLIENT_SECRET,
  );

  if (accessConfigured && oidcConfigured) {
    return {
      kind: "misconfigured",
      reason:
        "both Cloudflare Access and OIDC modes are configured; set exactly one",
    };
  }

  if (!accessConfigured && !oidcConfigured) {
    return {
      kind: "misconfigured",
      reason:
        "no identity provider configured; set either CF_ACCESS_TEAM_DOMAIN + CF_ACCESS_AUD + ACCESS_ALLOWED_EMAILS, or OIDC_ISSUER + OIDC_CLIENT_ID + OIDC_CLIENT_SECRET + OIDC_ALLOWED_SUBS",
    };
  }

  if (accessConfigured) {
    if (!env.CF_ACCESS_TEAM_DOMAIN || !env.CF_ACCESS_AUD) {
      return {
        kind: "misconfigured",
        reason:
          "Cloudflare Access mode requires both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD",
      };
    }
    const allowedEmails = parseAllowlist(env.ACCESS_ALLOWED_EMAILS);
    if (allowedEmails.length === 0) {
      return {
        kind: "misconfigured",
        reason:
          "ACCESS_ALLOWED_EMAILS must list at least one email; refusing to accept any Access identity",
      };
    }
    return {
      kind: "access",
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      aud: env.CF_ACCESS_AUD,
      allowedEmails,
    };
  }

  // OIDC branch
  if (!env.OIDC_ISSUER || !env.OIDC_CLIENT_ID || !env.OIDC_CLIENT_SECRET) {
    return {
      kind: "misconfigured",
      reason:
        "OIDC mode requires OIDC_ISSUER, OIDC_CLIENT_ID, and OIDC_CLIENT_SECRET",
    };
  }
  const allowed = parseAllowlist(env.OIDC_ALLOWED_SUBS);
  if (allowed.length === 0) {
    return {
      kind: "misconfigured",
      reason:
        "OIDC_ALLOWED_SUBS must list at least one email or sub; refusing to accept any upstream identity",
    };
  }
  return {
    kind: "oidc",
    issuer: env.OIDC_ISSUER.replace(/\/+$/, ""),
    clientId: env.OIDC_CLIENT_ID,
    clientSecret: env.OIDC_CLIENT_SECRET,
    scopes: env.OIDC_SCOPES ?? "openid email profile",
    allowed,
  };
}

export interface Identity {
  sub: string;
  email?: string;
}

// Returns true if the given identity passes the mode's allowlist. Comparison
// is case-insensitive. For OIDC we accept either email or sub as the match
// key since some IdPs (e.g. certain SAML-backed OIDC bridges) do not emit
// email.
export function isAllowed(mode: IdpMode, identity: Identity): boolean {
  if (mode.kind === "access") {
    const email = identity.email?.toLowerCase();
    if (!email) return false;
    return mode.allowedEmails.includes(email);
  }
  if (mode.kind === "oidc") {
    const email = identity.email?.toLowerCase();
    const sub = identity.sub.toLowerCase();
    return (
      (email !== undefined && mode.allowed.includes(email)) ||
      mode.allowed.includes(sub)
    );
  }
  return false;
}
