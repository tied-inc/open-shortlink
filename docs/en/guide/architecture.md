# Architecture

## Overview

Open Shortlink is a single Worker application running on Cloudflare Workers. Redirect, REST API, and MCP server are all integrated into one Worker.

```
┌─────────────────────────────────────────────────┐
│                Cloudflare Workers                │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Redirect │  │ REST API │  │  MCP Server   │  │
│  │ GET /:slug│  │ /api/*   │  │  /mcp         │  │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │                │          │
│       ▼              ▼                ▼          │
│  ┌─────────────────────────────────────────┐     │
│  │         Shared business logic            │     │
│  │  (link mgmt / analytics / slug / auth)   │     │
│  └──────┬──────────────────┬───────────────┘     │
│         │                  │                     │
│         ▼                  ▼                     │
│  ┌────────────┐    ┌─────────────────┐           │
│  │     KV     │    │ Analytics Engine│           │
│  │ slug→URL   │    │   click data    │           │
│  └────────────┘    └─────────────────┘           │
└─────────────────────────────────────────────────┘
```

## Tech stack

| Layer | Technology | Rationale |
|---|---|---|
| Framework | Hono | Lightweight, Workers-native, type-safe |
| Language | TypeScript | Type safety, developer experience |
| Package manager | Bun | Fast, TypeScript-native |
| Redirect storage | Cloudflare KV | Optimal for key-value lookup, edge reads, large free tier |
| Analytics | Cloudflare Analytics Engine | Async writes, SQL queries, large free tier |
| MCP | Remote MCP (SSE) | Built into the Worker, no separate server needed |

## Request flow

### Redirect (hot path)

```
User → GET /:slug
  → KV.get(slug)
  → 302 Redirect if URL is found
  → Async write of click data to Analytics Engine
  → 404 if URL is not found
```

Redirects do not require authentication. Writes to Analytics Engine run asynchronously via `waitUntil()`, so they don't affect response latency.

### API / MCP operations

```
Client → POST /api/links (OAuth access token)
  → OAuthProvider validates the access token (401 / 503)
  → URL validation
  → slug generation (or duplicate check for custom slug)
  → KV.put(slug, url, { expirationTtl? })
  → 201 Created
```

## Storage design

### KV (for redirect)

```
Key:      slug (e.g. "abc123")
Value:    target URL (e.g. "https://example.com/very/long/path")
Metadata: { createdAt: number, expiresAt?: number }
```

- Expiration is implemented via KV's `expirationTtl` (Cloudflare auto-deletes)
- A redirect completes in a single `KV.get()`

### Analytics Engine (for analytics)

The following data point is recorded for each click:

| Field | Type | Content |
|---|---|---|
| blob1 | string | slug |
| blob2 | string | Referrer |
| blob3 | string | Country code (from `cf.country`) |
| blob4 | string | User-Agent |
| blob5 | string | AI flag (`"ai"` or `"human"`) |
| double1 | number | Timestamp |

## Authentication

- **Redirect endpoint** (`GET /:slug`): No authentication
- **API endpoints** (`/api/*`): OAuth 2.1 access token
- **MCP endpoint** (`/mcp`): OAuth 2.1 access token

`@cloudflare/workers-oauth-provider` validates access tokens in front of
`/api` and `/mcp`. User identity is not handled by the Worker itself and is
**delegated to an external IdP** (Cloudflare Access or any OpenID Connect
provider). See the [Security Policy](./security) for details.

## Project structure

```
open-shortlink/
├── src/
│   ├── index.ts              # OAuthProvider protects /api, /mcp
│   ├── app.ts                # defaultHandler (redirect, /authorize, /oauth/callback)
│   ├── routes/
│   │   ├── redirect.ts       # GET /:slug → 302
│   │   └── api.ts            # REST API (CRUD + analytics) — behind OAuth
│   ├── mcp/
│   │   ├── server.ts         # JSON-RPC / Streamable HTTP — behind OAuth
│   │   └── tools.ts          # MCP tool definitions
│   ├── oauth/
│   │   ├── authorize.ts      # /authorize and /oauth/callback
│   │   └── idp/
│   │       ├── index.ts      # IdP mode selection and allowlist
│   │       ├── access.ts     # Cloudflare Access JWT verification
│   │       └── oidc.ts       # Generic OIDC discovery + PKCE + ID token verification
│   ├── analytics/
│   │   ├── tracker.ts        # Writes to Analytics Engine
│   │   └── ai-detector.ts    # AI User-Agent detection
│   ├── storage/
│   │   └── kv.ts             # Cloudflare KV operations
│   └── lib/
│       ├── slug.ts           # NanoID-based slug generation
│       └── validate.ts       # URL validation
├── docs/                     # VitePress docs site
├── wrangler.toml
├── package.json
└── tsconfig.json
```
