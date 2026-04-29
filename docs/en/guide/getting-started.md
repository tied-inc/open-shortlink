# Quick Start

::: warning First: configuring an authentication provider (IdP) is required
Open Shortlink delegates user authentication to an external IdP. You must
configure either **Cloudflare Access** or **any OpenID Connect provider**
(Auth0 / Okta / Entra ID / Google Workspace / Keycloak, etc.). Without
configuration, `/authorize` returns **503** and MCP clients cannot sign in
(fail-closed design). See the [Security Policy](./security) for details.
:::

## Deploy to Cloudflare (1-click)

When you press the button, the setup screen prompts you for IdP secrets and
the Worker name. Submitting completes everything in one go: fork → automatic
KV provisioning → Worker deploy → Secret registration.

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tied-inc/open-shortlink)

::: warning One-time prerequisite (30 seconds)
**Manually create one Analytics Engine dataset in advance.** You can do this
either before or right after pressing the button.

1. Cloudflare dashboard → **Storage & Databases → Analytics Engine**
2. Click **"Create Dataset"** in the upper right
3. Name it **`open_shortlink_clicks`** (must match `wrangler.toml` exactly)

Without this, the deploy fails with `code: 10089 — You need to enable
Analytics Engine`. By Cloudflare's design, this initialization is required
only the first time you use Analytics Engine on an account (subsequent
forks don't need it).
:::

### Values to enter (OIDC configuration)

If you use a generic OIDC provider (Auth0 / Okta / Google / Entra ID / Keycloak / Authelia, etc.),
register a new OAuth application on the upstream IdP and set its
**`redirect_uri`** to `https://<your-worker>.workers.dev/oauth/callback`,
then enter the values below.

| Item | Value | Notes |
|---|---|---|
| Worker name | `open-shortlink`, etc. | Cannot be changed later (preserved through redeploy) |
| `OIDC_ISSUER` | e.g. `https://accounts.google.com` | Upstream IdP issuer URL |
| `OIDC_CLIENT_ID` | client_id issued upstream | — |
| `OIDC_CLIENT_SECRET` | client_secret issued upstream | Stored as a Secret |
| `OIDC_ALLOWED_SUBS` | `you@example.com` | Comma-separated list of allowed email / sub |
| `OIDC_SCOPES` | Leave blank (default: `openid email profile`) | Add more if needed |
| `CORS_ALLOW_ORIGIN` | Leave blank | Only if you host a UI on a different domain |
| `PUBLIC_BASE_URL` | Leave blank | Add after configuring a custom domain |

### Values to enter (Cloudflare Access)

If you put the Worker behind an Access application, OIDC values are
unnecessary. Set the following instead. Access handles user authentication,
and the Worker verifies the `Cf-Access-Jwt-Assertion` carried on
`/authorize` requests.

| Item | Value | Notes |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `acme.cloudflareaccess.com` | Access team domain |
| `CF_ACCESS_AUD` | Access app AUD tag | Found in the Zero Trust dashboard |
| `ACCESS_ALLOWED_EMAILS` | `you@example.com,teammate@example.com` | Sign-in allowlist |

### Verifying after deploy

```bash
# If OAuth discovery returns, the OAuth layer is working
curl -s https://<your-worker>.workers.dev/.well-known/oauth-authorization-server | jq .

# Authenticated endpoints return 401 without a token
curl -i https://<your-worker>.workers.dev/api/links
# → 401 unauthorized means OAuth protection is working

# /authorize returns 503 when the IdP is not configured;
# in OIDC mode it redirects upstream once configured
curl -i "https://<your-worker>.workers.dev/authorize?response_type=code&client_id=test&redirect_uri=https://example"
# → 503 means IdP configuration is missing (check Workers → Settings → Variables)
# → 302 Location: https://<idp>/... means OIDC mode is working
```

### Optional / recommended additional settings

- **Custom domain**: Settings → Triggers → Custom Domains
- **Close `*.workers.dev` and Preview URLs**: The first deploy log shows:
  ```
  ▲ workers_dev is not in your Wrangler file → *.workers.dev is enabled by default
  ▲ preview_urls is not in your Wrangler file → Preview URLs are enabled
  ```
  Once you have a custom domain, add the following to `wrangler.toml` and
  redeploy to reduce attack surface (if you operate on `*.workers.dev`
  without occupying an apex domain, leave `workers_dev = true`):
  ```toml
  workers_dev = false
  preview_urls = false
  ```

## Manual setup

### Prerequisites

- Bun
- Cloudflare account
- Wrangler CLI (`bun add -g wrangler`)

### Steps

```bash
# 1. Clone the repository
git clone https://github.com/tied-inc/open-shortlink.git
cd open-shortlink

# 2. Install dependencies
bun install

# 3. Log in to Cloudflare
wrangler login

# 4. Configure one IdP (one of the following)
#    --- OIDC mode ---
wrangler secret put OIDC_ISSUER          # e.g. https://accounts.google.com
wrangler secret put OIDC_CLIENT_ID
wrangler secret put OIDC_CLIENT_SECRET
wrangler secret put OIDC_ALLOWED_SUBS    # e.g. you@example.com
#    --- Cloudflare Access mode ---
# wrangler secret put CF_ACCESS_TEAM_DOMAIN
# wrangler secret put CF_ACCESS_AUD
# wrangler secret put ACCESS_ALLOWED_EMAILS

# 5. Deploy (KV / OAUTH_KV are auto-created and bound)
bun run deploy
```

## Environment variables

| Name | Description | Required |
|---|---|---|
| `OIDC_ISSUER` | Upstream OIDC provider issuer URL | Yes if not using Access |
| `OIDC_CLIENT_ID` | client_id issued upstream | Same as above |
| `OIDC_CLIENT_SECRET` | client_secret upstream (store as Secret) | Same as above |
| `OIDC_ALLOWED_SUBS` | Comma-separated email / sub allowlist | Same as above |
| `OIDC_SCOPES` | Scopes to request upstream (default: `openid email profile`) | No |
| `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` | Yes if using Access |
| `CF_ACCESS_AUD` | Access app AUD tag | Same as above |
| `ACCESS_ALLOWED_EMAILS` | Comma-separated email allowlist | Same as above |
| `CORS_ALLOW_ORIGIN` | CORS allowlist (allows all if unset) | No |
| `PUBLIC_BASE_URL` | Canonical origin used for `shortUrl` | No |
| `CF_ACCOUNT_ID` / `CF_ANALYTICS_TOKEN` | Only when using the analytics API | No |

## Cloudflare resources

The 1-click deploy **automatically creates and binds** the following
resources. You don't need to set IDs manually.

- **KV Namespace** (`SHORTLINKS`) — Stores slug → URL mapping. Wrangler 4.45+
  detects that there's no `id` in `[[kv_namespaces]]` and creates a new
  namespace with a name like `open-shortlink-shortlinks`
- **KV Namespace** (`OAUTH_KV`) — Stores OAuth tokens, client registrations,
  OIDC discovery cache, and upstream authorization state. Auto-created
- **Analytics Engine** (`ANALYTICS`) — Records click data. **The dataset
  must be created in advance** (see "One-time prerequisite" above). By
  Cloudflare's design, only the first dataset on an account needs to be
  created manually; afterwards the app writes to the same-named dataset

## Local development

```bash
# Start the dev server (with local emulation of KV and Analytics Engine)
bun run dev

# Run tests
bun test
```

`wrangler dev` emulates KV and Analytics Engine locally, so you can develop without a Cloudflare account.

## Connecting the MCP server

After deploy, connect MCP clients like Claude Desktop. See the client setup
section of [MCP Server](../mcp) for details.

### Claude Desktop

1. Claude Desktop → **Settings** → **Add custom connector**
2. **Name**: `Open Shortlink`, **Remote MCP server URL**: `https://<your-worker>.workers.dev/mcp`
3. Leave OAuth fields blank and click **Add**
4. `/authorize` opens in your browser and redirects to the configured IdP's
   sign-in screen (Google / Okta / Auth0 / Access, etc.). Authenticating
   with an account in `OIDC_ALLOWED_SUBS` or `ACCESS_ALLOWED_EMAILS`
   automatically returns to Claude Desktop and completes the connection.

See [MCP Server → Claude Desktop](../mcp#claude-desktop) for details.
