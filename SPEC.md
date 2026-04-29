# Open Shortlink Specification

> 🇯🇵 [日本語版 / Japanese version](./SPEC.ja.md)

## Overview

An open-source URL shortener that runs on Cloudflare Workers within the free
tier for typical small workloads.

## Design principles

- **Single-tenant**: no user management. Each operator forks the project and
  deploys it to their own Cloudflare account.
- **Low cost**: free-tier deployment is fully supported.
- **AI-native**: no web UI; managed entirely through the REST API or the
  built-in Remote MCP server.
- **Single Worker**: redirect, REST API, and MCP server are all served from a
  single Worker.

## Stack

| Layer | Technology |
|---|---|
| Framework | Hono |
| Language | TypeScript |
| Package manager | Bun |
| Redirect storage | Cloudflare KV (with geo-variant support) |
| Analytics | Cloudflare Analytics Engine |
| MCP | Remote MCP (built into the Worker) |
| Documentation | VitePress (GitHub Pages) |

## Cloudflare resources

| Resource | Binding | Purpose | Free tier |
|---|---|---|---|
| Workers | — | Application runtime | 100k requests / day |
| KV | `SHORTLINKS` | slug → URL mapping | 100k reads / day, 1k writes / day |
| Analytics Engine | `ANALYTICS` | Click data | 100k writes / day, 10k queries / day |

## Environment variables

The Worker is protected by **OAuth 2.1**. User authentication is delegated
to an external IdP. Configure **exactly one** of Mode A (Cloudflare Access)
or Mode B (generic OIDC); if both are configured, `/authorize` returns 503.

### Mode A: Cloudflare Access

| Name | Required | Description |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | ◯ | e.g. `acme.cloudflareaccess.com` |
| `CF_ACCESS_AUD` | ◯ | AUD tag of the Access application |
| `ACCESS_ALLOWED_EMAILS` | ◯ | Comma-separated email allowlist (empty → 503) |

### Mode B: generic OIDC

| Name | Required | Description |
|---|---|---|
| `OIDC_ISSUER` | ◯ | Issuer URL of the upstream OpenID Connect provider |
| `OIDC_CLIENT_ID` | ◯ | client_id issued by the upstream IdP |
| `OIDC_CLIENT_SECRET` | ◯ | Client secret (store as a Worker Secret) |
| `OIDC_ALLOWED_SUBS` | ◯ | Comma-separated email / sub allowlist (empty → 503) |
| `OIDC_SCOPES` | optional | Space-separated scopes (default: `openid email profile`) |

### Other

| Name | Required | Description | How to set |
|---|---|---|---|
| `CF_ACCOUNT_ID` | when using analytics queries | Cloudflare account ID | `wrangler secret put CF_ACCOUNT_ID` |
| `CF_ANALYTICS_TOKEN` | when using analytics queries | API token with Analytics Engine read | `wrangler secret put CF_ANALYTICS_TOKEN` |
| `CORS_ALLOW_ORIGIN` | optional | Comma-separated CORS allowlist; unset or `*` allows all origins | `wrangler secret put CORS_ALLOW_ORIGIN` |
| `PUBLIC_BASE_URL` | optional | Canonical origin used in `shortUrl` responses | `wrangler secret put PUBLIC_BASE_URL` |
| `REDIRECT_HOST` / `API_HOST` | optional | Force host-split routing | `[vars]` or Secret |

## Storage design

### KV

```
Key:      slug (e.g. "abc123")
Value:    target URL (e.g. "https://example.com/very/long/path")
          OR a JSON envelope when geo variants are present:
          { "u": "https://example.com", "g": { "US": "...", "JP": "..." } }
Metadata: { createdAt: number, expiresAt?: number, url?: string }
```

- Expirations use KV's `expirationTtl` (Cloudflare deletes the entry
  automatically).
- Links without geo variants are stored as a raw URL string (back-compat).

### Analytics Engine

| Column | Type | Contents |
|---|---|---|
| blob1 | string | slug |
| blob2 | string | Referrer |
| blob3 | string | Country code (`request.cf.country`) |
| blob4 | string | User-Agent |
| blob5 | string | AI flag (`"ai"` / `"human"`) |
| double1 | number | Timestamp (Unix ms) |

## Endpoints

### Redirect (no authentication)

| Method | Path | Description |
|---|---|---|
| GET | `/:slug` | 302 redirect. Reads the URL from KV and asynchronously logs the click to Analytics Engine. |

### Link management API (OAuth access token)

| Method | Path | Description |
|---|---|---|
| POST | `/api/links` | Create a short URL |
| GET | `/api/links` | List links (cursor-paginated) |
| GET | `/api/links/:slug` | Link details |
| DELETE | `/api/links/:slug` | Delete a link |

### Analytics API (OAuth access token)

| Method | Path | Description |
|---|---|---|
| GET | `/api/analytics/:slug` | Per-slug click stats |
| GET | `/api/analytics/:slug/timeseries` | Time-series data |
| GET | `/api/analytics/top` | Top links |
| GET | `/api/analytics/ai` | AI traffic stats |

### MCP (OAuth access token)

| Path | Description |
|---|---|
| `/mcp` | Remote MCP server endpoint |

## API details

### POST /api/links

Request:
```json
{
  "url": "https://example.com/path",
  "slug": "custom-slug",    // optional; auto-generated 6-char slug if omitted
  "expiresIn": 86400,        // optional; seconds. Omit for no expiration.
  "geo": {                   // optional; per-country redirect overrides
    "US": "https://example.com/en",
    "JP": "https://example.com/ja"
  }
}
```

- `geo` keys must be ISO 3166-1 alpha-2 (two-letter, uppercase). Lowercase
  input is normalized.
- If any `geo` value is invalid or points to the Worker's own host, the
  request is rejected with 400.
- If no `geo` entry matches the requesting country, the request falls back
  to `url` (the default).

Response (201):
```json
{
  "slug": "abc123",
  "url": "https://example.com/path",
  "geo": { "US": "...", "JP": "..." },  // present only when geo was set
  "shortUrl": "https://your-domain.com/abc123",
  "createdAt": "2025-01-01T00:00:00Z",
  "expiresAt": "2025-01-02T00:00:00Z"
}
```

Errors:
- 400: invalid URL / invalid slug / invalid geo key / invalid geo URL
- 409: slug already in use

### GET /api/links

Query: `?limit=20&cursor=xxx`

Response (200):
```json
{
  "links": [{ "slug", "url", "shortUrl", "createdAt", "expiresAt" }],
  "cursor": "next-page-cursor"
}
```

### GET /api/links/:slug

Response (200): a link object.
Errors: 404.

### DELETE /api/links/:slug

Response: 204.
Errors: 404.

### GET /api/analytics/:slug

Query: `?period=7d` (1d, 7d, 30d, 90d).

Response (200):
```json
{
  "slug": "abc123",
  "period": "7d",
  "totalClicks": 1234,
  "uniqueCountries": 15,
  "aiClicks": 89,
  "humanClicks": 1145,
  "topReferers": [{ "referer": "url", "clicks": 500 }],
  "topCountries": [{ "country": "JP", "clicks": 800 }]
}
```

### GET /api/analytics/:slug/timeseries

Query: `?period=7d&interval=1d` (interval: `1h`, `1d`).

Response (200):
```json
{
  "slug": "abc123",
  "period": "7d",
  "interval": "1d",
  "data": [{ "timestamp": "ISO8601", "clicks": 150, "aiClicks": 10 }]
}
```

### GET /api/analytics/top

Query: `?period=7d&limit=10`.

Response (200):
```json
{
  "period": "7d",
  "links": [{ "slug": "abc123", "url": "https://...", "clicks": 1234 }]
}
```

### GET /api/analytics/ai

Query: `?period=7d`.

Response (200):
```json
{
  "period": "7d",
  "totalClicks": 5000,
  "aiClicks": 450,
  "humanClicks": 4550,
  "aiRatio": 0.09,
  "byBot": [{ "bot": "GPTBot", "clicks": 200 }]
}
```

## MCP tools

| Tool | Description | Maps to |
|---|---|---|
| `create_link` | Create a short URL | POST /api/links |
| `list_links` | List links | GET /api/links |
| `get_link` | Link details | GET /api/links/:slug |
| `delete_link` | Delete a link | DELETE /api/links/:slug |
| `get_analytics` | Per-slug stats | GET /api/analytics/:slug |
| `get_timeseries` | Time-series clicks | GET /api/analytics/:slug/timeseries |
| `get_top_links` | Top links | GET /api/analytics/top |
| `get_ai_stats` | AI traffic stats | GET /api/analytics/ai |

## Slug generation

- NanoID-based base62 (a-z, A-Z, 0-9).
- Default length: 6 characters (62^6 ≈ 56.8 billion combinations).
- Custom slugs may use letters, digits, hyphen (`-`), and underscore (`_`),
  up to 64 characters.
- Reserved: the `api` and `mcp` prefixes (to avoid routing collisions),
  plus the well-known paths `health`, `healthz`, `ready`, `readyz`,
  `metrics`, `favicon.ico`, `robots.txt`, `sitemap.xml`, and `.well-known`.

## AI User-Agent detection

User-Agents containing any of the following substrings are classified as AI
traffic:

```
GPTBot, ChatGPT-User, ClaudeBot, Claude-Web,
PerplexityBot, Bytespider, Applebot-Extended,
Google-Extended, CCBot, anthropic-ai, cohere-ai,
meta-externalagent
```

## Authentication

The operator-facing security policy lives in
[`docs/guide/security.md`](./docs/guide/security.md). This SPEC only specifies
the behaviors the implementation must guarantee.

- **Primary line of defense (required)**: OAuth 2.1 (PKCE S256 + dynamic
  client registration). `@cloudflare/workers-oauth-provider` validates access
  tokens for `/api/*` and `/mcp`.
- **User authentication is delegated to an external IdP.** The operator
  configures **either**:
  - Mode A — Cloudflare Access: set `CF_ACCESS_TEAM_DOMAIN`,
    `CF_ACCESS_AUD`, and `ACCESS_ALLOWED_EMAILS`. The Worker verifies the
    `Cf-Access-Jwt-Assertion` header against the team JWKS at
    `https://<team>/cdn-cgi/access/certs`.
  - Mode B — generic OIDC: set `OIDC_ISSUER`, `OIDC_CLIENT_ID`,
    `OIDC_CLIENT_SECRET`, and `OIDC_ALLOWED_SUBS`. The Worker fetches
    discovery from `${issuer}/.well-known/openid-configuration` and delegates
    via OAuth 2.1 + PKCE.
- Redirect endpoint (`GET /:slug`): unauthenticated.
- `/api/*` and `/mcp`: require a valid OAuth access token. OAuthProvider
  returns 401 Unauthorized when invalid.
- `/authorize` behavior:
  - Returns **503** if no IdP is configured, both modes are configured at
    the same time, or the relevant allowlist is empty.
  - Access mode: validates `Cf-Access-Jwt-Assertion` against the JWKS,
    checks `iss` / `aud` / `exp` and the email allowlist, then calls
    `completeAuthorization` and 302-redirects the downstream client.
  - OIDC mode: generates PKCE (S256), `state`, and `nonce`, then 302-
    redirects to the upstream IdP's `authorization_endpoint`.
- `/oauth/callback` (OIDC mode only):
  - Looks up `state` in OAUTH_KV (single-use, 10-minute TTL).
  - Posts `code` + PKCE `code_verifier` to the upstream `/token` and
    receives the ID token.
  - Verifies the ID token against the JWKS, checks `iss` / `aud` / `nonce`
    / `exp` and the allowlist, then calls `completeAuthorization`.
- Allowlist matching is **exact, case-insensitive**, with whitespace
  trimmed from both ends.
- If the upstream issuer changes between `/authorize` and `/oauth/callback`,
  the request is rejected with 400.
- Access token lifetime: 1 hour (default). Refresh token lifetime: 30 days.

## Security controls

- **URL validation**: only HTTP(S) URLs are accepted; the following hosts
  are rejected:
  - `localhost`, `*.local`, `*.internal`, `*.localhost`, `*.onion` and
    similar internal TLDs
  - Loopback (`127.0.0.0/8`, `::1`)
  - RFC1918 private ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - Link-local (`169.254.0.0/16`, `fe80::/10`) — including the cloud
    metadata address `169.254.169.254`
  - CGNAT (`100.64.0.0/10`)
  - Multicast (`224.0.0.0/4`) and reserved (`240.0.0.0/4`)
  - IPv6 ULA (`fc00::/7`), multicast (`ff00::/8`), IPv4-mapped (`::ffff:*`),
    and NAT64
  - Embedded credentials (`user:pass@host`)
  - URLs longer than 2048 characters
- **Slug validation**: `isValidSlug` is applied to `/:slug` and analytics
  endpoints. The `api` / `mcp` prefixes are rejected, plus reserved
  well-known paths (`health`, `metrics`, etc.).
- **HTTP security headers**: every response carries
  `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`,
  `Referrer-Policy: no-referrer`, `Strict-Transport-Security`,
  `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and
  `Permissions-Policy`.
- **Rate limiting**: keyed only by the trusted `cf-connecting-ip`; the
  Worker does not honor `x-forwarded-for`.
- **Request body limits**: `POST /api/links` is capped at 16 KiB; `POST
  /mcp` at 256 KiB.
- **Error messages**: internal errors from MCP are surfaced to clients as
  `tool execution failed`; full details are written to the server log only.

## Rate limiting

- Built into the Worker (`src/middleware/rate-limit.ts`): per-IP, defaults
  to 120 requests per 60 seconds for `/api/*` and `/mcp`, `/mcp/*`.
- State is per-isolate, so this acts as a **burst safety net**, not a
  global limit.
- On overflow the Worker returns `429 Too Many Requests` along with
  `Retry-After`, `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and
  `X-RateLimit-Reset` headers.
- Global enforcement is the operator's responsibility via Cloudflare Rate
  Limiting Rules. Setup is documented in `docs/guide/deploy.md`.

## Request flow

### Redirect

```
GET /:slug
  → caches.default.match(req)
  → HIT  → 302 (cached) + waitUntil(Analytics Engine write)
  → MISS → KV.get(slug)
        → not found → 404
        → no geo   → 302 + waitUntil(cache.put + Analytics write)
        → has geo  → look up by request.cf.country; fall back to default
                     URL if no match. Set `Cache-Control: private, no-store`
                     so neither edge nor browser caches the response,
                     plus waitUntil(Analytics write).
```

- The edge cache key is the full request URL and does not include country,
  so links with geo variants are intentionally not written to the cache.
  Because they are never cached, every cache hit is guaranteed to be a
  non-geo response.
- Non-geo links are cached at the colo with `public, s-maxage=60`.
- Analytics Engine writes happen via `waitUntil()`, off the response
  critical path.

### Geo-variant caveats

- Country detection uses `request.cf.country` (Cloudflare's classification).
  VPNs or carrier-grade NAT may make this drift from the user's actual
  location.
- Geo variants are designed for a small number of overrides — only specify
  the countries you want to handle differently and let everyone else fall
  back to the default URL.
- Accept-Language-based variants should be handled on the landing page
  side. The shortener focuses on coarse country-level routing.

## Deployment

- **Deploy to Cloudflare button**: shipped in the README. One click forks
  the repo and walks the user through deployment in the Cloudflare console.
- **Manual**: `wrangler deploy`.
- **CI/CD**: Cloudflare Workers Builds picks up pushes to `main` and
  deploys automatically. The repo does not run `wrangler deploy` from
  GitHub Actions.
- **Documentation**: GitHub Pages, built with VitePress.

## Project layout

```
open-shortlink/
├── src/
│   ├── index.ts              # Hono application entrypoint
│   ├── routes/
│   │   ├── redirect.ts       # GET /:slug → 302
│   │   └── api.ts            # REST API (CRUD + analytics)
│   ├── mcp/
│   │   └── tools.ts          # MCP tool definitions
│   ├── analytics/
│   │   ├── tracker.ts        # Analytics Engine writes
│   │   └── ai-detector.ts    # AI User-Agent detection
│   ├── storage/
│   │   └── kv.ts             # Cloudflare KV access
│   └── lib/
│       ├── slug.ts           # NanoID-based slug generation
│       └── validate.ts       # URL validation
├── docs/                     # VitePress documentation
├── .github/workflows/
│   └── docs.yml              # Doc deploys (Worker deploys via Cloudflare Workers Builds)
├── wrangler.toml
├── package.json
└── tsconfig.json
```
