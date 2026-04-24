export interface Bindings {
  SHORTLINKS: KVNamespace;
  ANALYTICS: AnalyticsEngineDataset;
  OAUTH_KV: KVNamespace;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  // Comma-separated origin allowlist for CORS. Unset => permissive (reflects
  // request Origin or `*`). Set to `*` to explicitly remain permissive.
  CORS_ALLOW_ORIGIN?: string;
  // Canonical origin used when building `shortUrl` in API responses and when
  // purging the edge cache. Example: "https://go.example.com".
  PUBLIC_BASE_URL?: string;
  // Optional host split: when set, redirect paths are only served on
  // REDIRECT_HOST and API / MCP paths are only served on API_HOST.
  REDIRECT_HOST?: string;
  API_HOST?: string;

  // ---- Identity Provider: Cloudflare Access mode ----
  // Team domain, e.g. "acme.cloudflareaccess.com". When set, /authorize
  // validates the Cf-Access-Jwt-Assertion header against this team's JWKS.
  CF_ACCESS_TEAM_DOMAIN?: string;
  // The AUD tag of the Access application that fronts this Worker.
  CF_ACCESS_AUD?: string;
  // Comma-separated allowlist of email addresses permitted to authorize.
  // Required when CF_ACCESS_TEAM_DOMAIN is set.
  ACCESS_ALLOWED_EMAILS?: string;

  // ---- Identity Provider: generic OIDC mode ----
  // OIDC issuer URL. Discovery is fetched from `${issuer}/.well-known/openid-configuration`.
  OIDC_ISSUER?: string;
  OIDC_CLIENT_ID?: string;
  OIDC_CLIENT_SECRET?: string;
  // Space-separated OAuth scopes sent to the upstream IdP. Defaults to
  // "openid email profile".
  OIDC_SCOPES?: string;
  // Comma-separated allowlist of `email` (preferred) or `sub` values permitted
  // to authorize. Required when OIDC_ISSUER is set.
  OIDC_ALLOWED_SUBS?: string;
}
