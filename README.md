# Open Shortlink

> 🇯🇵 [日本語版はこちら / Japanese version](./README.ja.md)

An open-source URL shortener that runs on Cloudflare Workers. Designed to fit
inside the free tier for small workloads, and to be operated by AI assistants
through a built-in Remote MCP server.

## Highlights

- **Low cost** — runs on Cloudflare Workers + KV; small deployments stay at
  $0/month.
- **Fast redirects** — slug → URL lookups served from KV at the edge.
- **Click analytics** — Cloudflare Analytics Engine tracks referrer, country,
  time-series, and AI-bot ratio asynchronously (no impact on redirect latency).
- **AI-native administration** — no web UI; manage links via REST API or as a
  Remote MCP server that AI assistants (Claude Desktop, Claude Code, etc.)
  can connect to directly.
- **Single Worker** — redirect, REST API, MCP server, and OAuth are all served
  from one Worker.

See the [documentation site](https://tied-inc.github.io/open-shortlink/) and
the [specification](./SPEC.md) for full details.

## Security policy (please read)

The API (`/api/*`) and MCP endpoint (`/mcp`) are reachable on a public
Cloudflare Workers URL, so **the operator is responsible for keeping them
locked down**:

- **Primary line of defense (required)**: OAuth 2.1 (PKCE + dynamic client
  registration). User authentication is delegated to an external IdP — choose
  **either** Cloudflare Access **or** any OpenID Connect provider (Auth0,
  Okta, Entra ID, Google Workspace, Keycloak, etc.). With no IdP configured
  or an empty allowlist, `/authorize` returns **503** and `/api/*` and `/mcp`
  return **401** (fail-closed).
- **Secondary (recommended)**: apply Cloudflare Rate Limiting Rules and WAF
  to `/api/*` and `/mcp`.

For the full checklist and IdP configuration steps, see the
[Security Guide](https://tied-inc.github.io/open-shortlink/guide/security).

## Cost comparison with hosted services

Estimated monthly cost across common URL-shortener tiers (figures rounded for
2026; FX assumed at $1 ≈ 150 JPY).

### Monthly price

| Scale | Vendor A<br>(US incumbent) | Vendor B<br>(custom-domain focus) | Vendor C<br>(mid-market) | Vendor D<br>(developer / new) | **Open Shortlink** |
|---|---|---|---|---|---|
| **Free tier** | ~10 links / month | ~500 links | ~1,000 clicks / month | ~1,000 links | **~100k clicks / day**<br>(Cloudflare free tier) |
| **Starter**<br>(thousands of clicks) | ~$8 / mo | ~$29 / mo | ~$20 / mo | ~$24 / mo | **$0** |
| **Standard**<br>(tens of thousands) | ~$29 / mo | ~$69 / mo | ~$50 / mo | ~$59 / mo | **$0** |
| **Large**<br>(hundreds of thousands) | from ~$199 / mo | from ~$499 / mo | from ~$150 / mo | from ~$199 / mo | **~$5**<br>(Workers paid tier) |
| **Enterprise** | contact sales | contact sales | contact sales | contact sales | usage-based, same model |

### Feature comparison

| Feature | A | B | C | D | **Open Shortlink** |
|---|---|---|---|---|---|
| Custom domain | Paid plan | ◎ (core) | Paid plan | ○ | ○ (Cloudflare config) |
| Click analytics | ○ | ○ | ○ | ○ | ○ |
| Referrer / country breakdown | Higher tiers | Higher tiers | ○ | ○ | ○ |
| API access | Higher tiers | Higher tiers | ○ | ○ | ○ (default) |
| Expiration | ○ | ○ | ○ | ○ | ○ |
| **AI-traffic detection** | ✕ | ✕ | ✕ | △ | **◎ (built in)** |
| **MCP server** | ✕ | ✕ | ✕ | ✕ | **◎ (built in)** |
| Self-hosting | ✕ | ✕ | ✕ | ✕ | ◎ |
| Data ownership | Vendor | Vendor | Vendor | Vendor | **Your Cloudflare account** |

### Cost-curve shape

| Monthly clicks | Hosted (standard plan) | Open Shortlink |
|---|---|---|
| 100k | ~$20–50 | **$0** (free tier) |
| 1M | ~$50–100 | **$0–2** (Workers metered only) |
| 10M | ~$200–500 | **$5–15** |

### Why pick Open Shortlink

- **Lowest TCO** for individual / small-team use — zero dollars at startup.
- **Data sovereignty** — every record lives in your own Cloudflare account.
- **AI-era ready** — visibility into AI-bot traffic and management via MCP.
- **No lock-in** — MIT-licensed, fork-friendly, easy to migrate away from.

> Pricing and features above are estimates from public information. Confirm
> the current numbers with each vendor before relying on them.

## Development

```bash
bun install
bun run dev          # local dev server (wrangler dev)
bun test             # run tests
bun run typecheck    # TypeScript check
bun run deploy       # deploy to Cloudflare
```

### Documentation site

```bash
bun run docs:dev     # VitePress dev server
bun run docs:build   # production build
```

## Contributing

Issues and pull requests are welcome. Please read
[CONTRIBUTING.md](./CONTRIBUTING.md) before opening a PR, and use the
[security reporting flow](./SECURITY.md) for vulnerability disclosures.

## License

[MIT](./LICENSE)
