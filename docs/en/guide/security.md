# Security Policy

Open Shortlink's API (`/api/*`) and MCP (`/mcp`) are exposed at a public
Cloudflare Workers URL **reachable from anywhere on the internet unless you
authenticate**. This project is designed on the assumption that all operators
follow the policy below.

## Security posture

| Layer | Method | Position | Required |
|---|---|---|---|
| **First line** | **OAuth 2.1 (PKCE + dynamic client registration)** — User authentication is delegated to an external IdP (Cloudflare Access or any OpenID Connect provider) | **Default / required** | ◎ |
| Second line | Cloudflare WAF / Rate Limiting Rules | Recommended | △ (optional) |
| Third line | Worker-built-in rate limit, security headers, host split | Enabled by default | — |

Principles:

1. **Never permit unauthenticated API/MCP access**. `/api/*` and `/mcp` are
   protected by OAuth 2.1, and OAuthProvider rejects requests without a
   valid access token with **401**
2. **If the IdP is unconfigured or incomplete, `/authorize` returns 503 and
   sign-in cannot succeed** (fail-closed). Authorization will **never**
   succeed for anonymous users
3. **Only redirect (`GET /:slug`) is exposed without authentication**. This
   is the inherent function of a short link, and it returns no information
   beyond the stored target URL
4. The operator must configure **either Cloudflare Access or generic OIDC,
   not both**. If both are set, `/authorize` returns 503 (mutually exclusive)
5. The email / sub returned from the upstream IdP is **strictly matched
   against an allowlist**. If the allowlist is empty, `/authorize` returns 503

## First line: OAuth 2.1 + external IdP (required)

`/api/*` and `/mcp` go through `@cloudflare/workers-oauth-provider`, which
verifies the access token before reaching downstream handlers. Access
tokens are issued by the OAuth 2.1 flow:
`/authorize` → external IdP sign-in → `/oauth/callback` (in OIDC mode) →
`/token`. **User identity is not handled by this Worker; it is delegated
to an external IdP.**

### Mode A: Cloudflare Access

Put the Worker behind a [Cloudflare Access](https://developers.cloudflare.com/cloudflare-one/)
application, and verify the signed JWT (`Cf-Access-Jwt-Assertion` header)
that Access issues. SSO is handled by Access, so there's no need to register
an additional OAuth app.

Configuration variables:

| Variable | Role |
|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | Access app AUD tag |
| `ACCESS_ALLOWED_EMAILS` | Comma-separated allowlist of sign-in emails (required) |

Architecture:

```
[ Short link users ]                  [ Operators / MCP clients ]
        │                                      │
        ▼                                      ▼
┌────────────────┐                   ┌────────────────────┐
│ go.example.com │                   │ api.example.com    │
│ (no auth)      │                   │ (Access protected) │
│  GET /:slug    │                   │  /api/*, /mcp      │
└────────┬───────┘                   └─────────┬──────────┘
         │                                      │ Access SSO
         └───────────── Worker ────────────────┘
                        + OAuth 2.1 access token
```

Notes when applying Access:

- The Access policy targets should include `/mcp` and `/api/*`. OAuth
  endpoints (`/authorize`, `/token`, `/register`, `/oauth/callback`,
  `/.well-known/oauth-authorization-server`) should be set to **Bypass**.
  However, since `/authorize` requires the Access JWT, exclude it from
  Bypass and apply **Allow (SSO)**:
  - `/authorize` → **Allow** (Access injects the JWT)
  - Other OAuth endpoints → **Bypass** (clients use them in the OAuth protocol)

### Mode B: generic OIDC provider

You can integrate with any OpenID Connect provider (Auth0 / Okta /
Microsoft Entra ID / Google Workspace / Keycloak / Authelia / Zitadel,
etc.).

The Worker acts as an OIDC **Relying Party**:

1. The client (e.g. Claude Desktop) calls `/authorize`
2. The Worker fetches discovery info from
   `${OIDC_ISSUER}/.well-known/openid-configuration` and generates
   PKCE + state + nonce
3. Redirects the browser to the **upstream IdP authorization endpoint**
4. After the user signs in upstream, the IdP returns to
   `/oauth/callback?code=...&state=...`
5. The Worker exchanges `code` at the **upstream `/token` endpoint** and
   verifies the ID Token's signature, `iss`, `aud`, `exp`, and `nonce` via JWKS
6. Only if `email` or `sub` is in `OIDC_ALLOWED_SUBS`, completes the
   downstream OAuth authorization for Claude Desktop

Configuration variables:

| Variable | Role |
|---|---|
| `OIDC_ISSUER` | e.g. `https://accounts.google.com`, Auth0/Okta tenant URL |
| `OIDC_CLIENT_ID` | client_id issued upstream |
| `OIDC_CLIENT_SECRET` | Stored as a Secret. Do not commit to source |
| `OIDC_ALLOWED_SUBS` | email / sub allowlist (required, comma-separated) |
| `OIDC_SCOPES` | Default `openid email profile`. Add `offline_access` if needed |

**Required upstream IdP registration:**

- Application type: **Confidential / Web**
- `redirect_uri`: `https://<your-worker>/oauth/callback`
- Granted grant types: **Authorization Code + PKCE**

### Enforcing IdP configuration (fail-closed)

- **Both modes set simultaneously is disallowed.** If both sets of secrets
  exist, `/authorize` returns 503
- **Allowlist required.** If `ACCESS_ALLOWED_EMAILS` / `OIDC_ALLOWED_SUBS`
  is empty, returns 503 (prevents the "anyone with a Google account can
  sign in" accident)
- **Detects upstream issuer changes.** If `OIDC_ISSUER` changes between
  `/authorize` and `/oauth/callback`, returns 400 (prevents mid-flight tampering)
- **One-time use of state.** Stored in `OAUTH_KV` with a 10-minute TTL,
  deleted on callback

### Worker-side enforcement (automatic)

The following is applied automatically in the code. Operators don't need to
configure anything for this to be enforced.

- `/api/*` and `/mcp` are protected by OAuthProvider, which verifies the
  access token and returns 401 on invalid (constant-time comparison)
- `/authorize` returns 503 if the IdP is unconfigured or the allowlist is empty
- JWT verification uses the `jose` library; JWKS is fetched from the
  provider's public endpoint and cached (1h)
- PKCE is fixed to S256. plain is forbidden (default of OAuthProvider)
- Access token lifetime: 1 hour / refresh token: 30 days

## Common security behavior

### MCP OAuth flow

MCP clients (Claude Desktop, Claude Code, etc.) authenticate as follows:

1. The client tries to connect to `/mcp`
2. Fetches metadata from `/.well-known/oauth-authorization-server`
3. Calls `/register` for dynamic client registration (first time only)
4. Opens `/authorize` in the browser → the configured IdP's sign-in screen
5. After the user signs in, calls `/token` to obtain an access token (1h)
   and refresh token (30d)
6. Subsequent MCP requests are authenticated with the access token. On
   expiry, the token refreshes automatically

See [MCP Server](../mcp#oauth-endpoints) for details.

### Using the REST API

The REST API (`/api/*`) also authenticates with OAuth access tokens. To
call directly with curl, use an access token obtained via the same OAuth
authorization as Claude Desktop, or add a custom implementation that
passes a Service Account / Machine-to-Machine access token issued by the
IdP through OAuthProvider's `resolveExternalToken` (not supported by default).

Operationally, the simplest approach for curl use is "go through Claude
Desktop in the browser once to get a short-lived token, then use it."

## Additional layer: WAF / Rate Limiting Rules (recommended)

Add another step at the Cloudflare edge. See the
[deploy guide](./deploy.md#rate-limiting) for details.

- **Rate Limiting Rules**: Limit `/api/*`, `/mcp` per IP (global)
- **WAF Custom Rules**: Block known malicious IPs / bots
- **Bot Management**: Anti-automation on Enterprise and above

The Worker's built-in rate limiter prevents bursts per isolate. To bundle
globally, always combine with Rate Limiting Rules.

## "What happens if I do nothing?"

This project is fail-closed. If you deploy via Deploy to Cloudflare without
configuring an IdP:

- `/authorize` returns **503 server misconfigured** and sign-in fails
- `/api/*` and `/mcp` return **401 unauthorized** and access tokens are
  never issued in the first place

The dangerous state of "running with everything visible to anyone" **never**
occurs.

However, **redirect (`GET /:slug`) is exposed without authentication**.
This must be so by functional requirement, so note the following:

- Don't embed secrets as query parameters into URLs registered via
  `POST /api/links` (you can read them via authenticated `GET /api/links/:slug`,
  but the `Location` header of `GET /:slug` redirects is visible to anyone)
- Use expiring links (`expiresIn`) to limit the public window

## Checklist

After deploy, check the following in order.

### IdP configuration

If using OIDC:

- [ ] Registered an OAuth app in the upstream IdP with `redirect_uri`
      set to `https://<your-worker>/oauth/callback`
- [ ] Set `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` /
      `OIDC_ALLOWED_SUBS` as Worker Secrets
- [ ] Did **not** set the Cloudflare Access variables (`CF_ACCESS_*`)

If using Cloudflare Access:

- [ ] Configured the Access application to protect the Worker's URL
- [ ] Set `CF_ACCESS_TEAM_DOMAIN` / `CF_ACCESS_AUD` /
      `ACCESS_ALLOWED_EMAILS` as Worker Secrets
- [ ] Did **not** set the OIDC variables (`OIDC_*`)

### Verification

- [ ] `curl https://<your-worker>/.well-known/oauth-authorization-server`
      returns OAuth metadata JSON
- [ ] `curl https://<your-worker>/api/links` returns **401**
- [ ] `curl "https://<your-worker>/authorize?response_type=code&client_id=..."`
      returns **302** in OIDC mode (redirects to upstream IdP), and
      **302 / 401 / 403** depending on JWT in Access mode
- [ ] Connecting MCP from Claude Desktop / Claude Code → upstream IdP
      sign-in screen opens in the browser → returns to Claude after sign-in
- [ ] Signing in with an email not in the allowlist returns
      **403 not authorized**

### Recommended

- [ ] Applied host splitting (`REDIRECT_HOST` / `API_HOST`) so that
      `go.example.com/api/...` is unreachable
- [ ] Applied Cloudflare Rate Limiting Rules to `/api/*` and `/mcp`

## Reporting vulnerabilities

If you find a security issue, please report it privately via
[GitHub Security Advisories](https://github.com/tied-inc/open-shortlink/security/advisories/new)
rather than opening a public issue.
