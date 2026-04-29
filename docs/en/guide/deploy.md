# Deploy

::: danger Required reading: the API does not start until an IdP is configured
Open Shortlink is fail-closed. If no IdP (Cloudflare Access or OIDC) is
configured, or the allowlist is empty, `/authorize` returns **503** and MCP
clients cannot obtain access tokens. Authenticated endpoints (`/api/*`,
`/mcp`) also return **401** without a token (so the service is not exposed
to the public). Right after deploying, be sure to read the
[Security Policy](./security) and configure exactly one IdP.
:::

## Deploy to Cloudflare (recommended, 1-click)

Pressing the button takes you to the Cloudflare setup screen, which completes
all of the following **at once, in place**:

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tied-inc/open-shortlink)

::: warning One-time prerequisite (30 seconds)
**Manually create one Analytics Engine dataset in advance.**

1. Cloudflare dashboard → **Storage & Databases → Analytics Engine**
2. Click **"Create Dataset"** in the upper right
3. Name it **`open_shortlink_clicks`** (must match the `dataset` field in
   `wrangler.toml` exactly)

Without this, deploy fails with `code: 10089 — You need to enable Analytics
Engine`. By Cloudflare's design, this initialization is required only the
first time you use Analytics Engine on an account (subsequent deploys on
the same account or forks to other repositories don't need it).
:::

### What the setup screen asks for

1. **GitHub fork target** — Pick your account / org
2. **Worker name** — Default is `open-shortlink`. Change as you like
3. **Environment variables / Secrets** — Configure exactly one of Cloudflare
   Access or OIDC. If you set both, `/authorize` returns 503
   - **OIDC mode** (any IdP):
     - `OIDC_ISSUER` (e.g. `https://accounts.google.com`)
     - `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET` (issued upstream)
     - `OIDC_ALLOWED_SUBS` (allowlisted email / sub for sign-in)
   - **Cloudflare Access mode**:
     - `CF_ACCESS_TEAM_DOMAIN` (`<team>.cloudflareaccess.com`)
     - `CF_ACCESS_AUD` (Access app AUD tag)
     - `ACCESS_ALLOWED_EMAILS`
   - `CORS_ALLOW_ORIGIN` (optional) — Set if you host a UI on another domain
   - `PUBLIC_BASE_URL` (optional) — Set after binding a custom domain
4. **KV** — Shown but Wrangler auto-provisions it. No manual ID needed
   (`SHORTLINKS` and `OAUTH_KV` are created)
5. **Analytics Engine** — Uses the dataset you created above

Pressing Deploy executes fork → KV creation → Worker deploy → Secret
registration end-to-end on the Cloudflare side.

### OIDC mode: upstream IdP registration in advance

If using OIDC, register an OAuth application in the upstream IdP (Google /
Auth0 / Okta / Entra ID / Keycloak, etc.) first.

- **Application type**: Confidential / Web
- **Redirect URI**: `https://<your-worker>.workers.dev/oauth/callback`
  (or `https://api.example.com/oauth/callback` if using a custom domain)
- **Granted grant types**: Authorization Code + PKCE
- **Scopes**: At minimum `openid email` (default is `openid email profile`)

Register the issued `client_id` and `client_secret` as Worker Secrets.

### Verifying right after deploy

```bash
# If OAuth discovery returns, the OAuth layer is working
curl -s https://<your-worker>.workers.dev/.well-known/oauth-authorization-server | jq .

# 401 unauthorized means OAuth protection is in effect (OK)
curl -i https://<your-worker>.workers.dev/api/links

# /authorize behavior tells you whether IdP config is healthy
curl -i "https://<your-worker>.workers.dev/authorize?response_type=code&client_id=test&redirect_uri=https://example"
# → 503 means the IdP is unconfigured / allowlist empty / both modes set
# → 302 means OIDC mode is working (Location: upstream IdP authorize URL)
# → 400/401 means JWT issue in Access mode (401 if not coming through Access)
```

If you get **503**, one of the IdP variables is missing. The response body's
`description` field lists what's missing. Add the required Secret in
Workers & Pages → target Worker → **Settings → Variables**.

### Subsequent updates

- Cloudflare's Workers Builds detects pushes to `main` on the forked GitHub
  repository and redeploys automatically
- KV namespaces are reused and data is preserved

### Optional / recommended additional settings

- **Custom domain**: Settings → Triggers → Custom Domains. Consider
  [splitting redirect host and API host](#recommended-split-redirect-host-and-api-host).
  After switching to a custom domain, update the upstream IdP's Redirect URI
  to match the new domain's `/oauth/callback`
- **Close `*.workers.dev` and Preview URLs**: After the first deploy you'll
  see:
  ```
  ▲ workers_dev is not in your Wrangler file → *.workers.dev is enabled by default
  ▲ preview_urls is not in your Wrangler file → Preview URLs are enabled
  ```
  Once you have a custom domain, add the following to `wrangler.toml`,
  commit, and redeploy to reduce attack surface (so API/MCP can't be
  reached via `*.workers.dev`). If you use `*.workers.dev` as the
  production URL, leave `workers_dev = true`:
  ```toml
  workers_dev = false
  preview_urls = false
  ```

## Manual deploy

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

# 4. Configure exactly one IdP (OIDC or Access — not both)
#    --- OIDC ---
wrangler secret put OIDC_ISSUER
wrangler secret put OIDC_CLIENT_ID
wrangler secret put OIDC_CLIENT_SECRET
wrangler secret put OIDC_ALLOWED_SUBS
#    --- Cloudflare Access ---
# wrangler secret put CF_ACCESS_TEAM_DOMAIN
# wrangler secret put CF_ACCESS_AUD
# wrangler secret put ACCESS_ALLOWED_EMAILS

# 5. Deploy (first time: SHORTLINKS and OAUTH_KV are auto-created and bound)
bun run deploy

# 6. Verify
curl -i https://<your-worker>.workers.dev/api/links
# → 401 unauthorized means OK (OAuth protection is in effect)
```

Store the upstream IdP's client secret in a password manager (1Password /
Bitwarden, etc.). Rotate from the IdP UI and overwrite with
`wrangler secret put OIDC_CLIENT_SECRET`. See the
[Security Policy](./security) for details.

> Wrangler 4.45+ auto-creates and binds KV namespaces when `[[kv_namespaces]]`
> has no `id` (created with names like `open-shortlink-SHORTLINKS`).
> Subsequent deploys reuse the same namespaces and preserve data. The
> legacy `wrangler kv namespace create` is unnecessary.

### wrangler.toml configuration

Use the bundled `wrangler.toml` as is. You don't need to manually fill in
KV namespace IDs.

```toml
name = "open-shortlink"
main = "src/index.ts"
compatibility_date = "2026-04-01"

[observability]
enabled = true

# Omitting `id` lets Wrangler auto-create on first deploy
[[kv_namespaces]]
binding = "SHORTLINKS"

[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "open_shortlink_clicks"
```

Don't put secrets like `OIDC_CLIENT_SECRET` in `[vars]`. Register them with
`wrangler secret put` or as Secrets in the Cloudflare dashboard.

## Custom domain

### Basic setup

Configure from the Cloudflare dashboard:

1. Workers & Pages → select the target Worker
2. Settings → Triggers → Custom Domains
3. Add a domain (e.g. `go.example.com`)

The domain's DNS must be managed by Cloudflare. Universal SSL takes a few minutes to tens of minutes to issue, during which 525/526 will be returned.

### Recommended: split redirect host and API host

Putting the short links and link management API on different subdomains
prevents accidentally exposing the API on the redirect host. `wrangler.toml`:

```toml
routes = [
  { pattern = "go.example.com/*",  zone_name = "example.com" },
  { pattern = "api.example.com/*", zone_name = "example.com" },
]

[vars]
PUBLIC_BASE_URL = "https://go.example.com"
REDIRECT_HOST   = "go.example.com"
API_HOST        = "api.example.com"
```

- `PUBLIC_BASE_URL`: The canonical origin used for `shortUrl` in API responses and for edge cache purges on DELETE
- `REDIRECT_HOST` / `API_HOST`: When both are set, each host returns 404 for any path that doesn't belong to its surface

If you only use one host (e.g. running everything on `go.example.com` without occupying an apex domain), set only `PUBLIC_BASE_URL` and omit `REDIRECT_HOST` / `API_HOST`.

### Reserved paths

The following paths take precedence over short links and never reach `/:slug`:

- `/` — Returns service info as JSON
- `/health` — Health check
- `/robots.txt` — `Disallow` for crawlers
- `/favicon.ico` — 204 No Content
- `/api/*`, `/mcp/*` — API / MCP (OAuth required)
- `/authorize`, `/token`, `/register`, `/oauth/callback` — OAuth endpoints
- `/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource` — OAuth metadata

Trying to register `api`, `mcp`, `health`, `robots`, `favicon`, `sitemap`,
`well-known`, `authorize`, `token`, `register`, or `oauth` as a slug returns 400.

## Rate limiting

Open Shortlink uses two layers of rate limiting.

### 1. Worker built-in (per-isolate)

The in-memory implementation in `src/middleware/rate-limit.ts` runs on
`/api/*`, `/mcp`, and `/mcp/*` per IP (default: 120 requests per 60 seconds).

- State is held per Worker isolate. Cloudflare processes requests in
  parallel across many isolates worldwide, so **this is not a global limit**.
- It's a safety net to deflect bursts and sloppy retries against a single
  isolate.
- On exceeding, returns `429 Too Many Requests` with `Retry-After` /
  `X-RateLimit-*` headers.

### 2. Cloudflare Rate Limiting Rules (recommended, global)

For single-tenant operation, we recommend enforcement via dashboard Rate
Limiting Rules. It works globally at the edge with no extra Worker code.

Configuration steps:

1. Cloudflare dashboard → target zone → **Security → WAF → Rate limiting rules**
2. Choose "Create rule"
3. **Match**: e.g. target `/api/` and `/mcp`
   - Field: `URI Path`
   - Operator: `starts with`
   - Value: `/api/` or `/mcp`
4. **Rate**: e.g. `120 requests per 1 minute`, Characteristics is `IP`
5. **Action**: `Block` (or `Managed Challenge`)
6. Save

> Rate Limiting Rules are available on some plans, including paid ones. If
> running on the free plan, use only the built-in Worker limiter, and put
> the custom domain behind the Cloudflare proxy to leverage WAF features
> as needed.

### Tuning

Default values are set in `src/index.ts`. Tune `windowMs` / `max` to your
traffic profile. Redirects (`GET /:slug`) are intentionally not rate-limited
(it's the hot path; we don't want to block legitimate traffic with strong
IP/regional skew). Use Rate Limiting Rules instead if needed.

## CI/CD

This repository does not run `wrangler deploy` from GitHub Actions.
Continuous deployment is intended to be completed entirely from
**Workers Builds in the Cloudflare console**.

### How Workers Builds works

When you set up via the Deploy to Cloudflare button, the Cloudflare side
auto-configures the following:

- The forked GitHub repository is connected to the Worker project
- Build command: `bun install && bun run deploy`
- Watched branch: `main`
- A push to `main` triggers a build → deploy on the Cloudflare side

Build logs and deploy status are available in the Cloudflare dashboard
under **Workers & Pages → target Worker → Deployments / Builds** tabs.

### Manual redeploy from the console

To rerun a failed deploy or redeploy a specific commit, just choose
"Retry deployment" on the relevant build in the **Deployments** tab.
No local or GitHub Actions command run is needed.

### If you want to use GitHub Actions

We generally recommend the console-based workflow, but if you must use
GitHub Actions, disable Workers Builds on the Cloudflare side and add the
following to your own workflow:

```yaml
- uses: oven-sh/setup-bun@v2
- run: bun install
- run: bun run deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

If both Cloudflare and GitHub Actions run `wrangler deploy` simultaneously
they will conflict, so consolidate to one or the other.
