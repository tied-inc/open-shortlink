---
name: shortlink
description: Use the Open Shortlink MCP tools to create and manage shortened URLs and to analyze click-through statistics, including the AI-bot share of traffic. Invoke when the user asks to shorten a URL, list / inspect / delete existing short links, or wants click analytics, top-link rankings, or AI-traffic ratios.
---

# Open Shortlink skill

Open Shortlink is a URL shortener that runs on Cloudflare Workers and embeds
a Remote MCP server. This skill is a guide for picking the right tool from
the seven exposed by the `shortlink` MCP server.

## Prerequisites

- Endpoint: `${SHORTLINK_MCP_URL}` (e.g. `https://your-shortlink.workers.dev/mcp`).
- Auth: **OAuth 2.1**. On first use the MCP client opens `/authorize` in the
  browser and the user signs in via the IdP that the Worker is configured
  for (Cloudflare Access or any OpenID Connect provider). Claude Desktop /
  Claude Code obtain and refresh the access token automatically — there is
  no static token to manage on the client.
- The connection is wired up in `.claude-plugin/plugin.json` under
  `mcpServers.shortlink`. Setting the `SHORTLINK_MCP_URL` environment
  variable enables the connection.

## Choosing a tool

| Goal | Tool |
|---|---|
| Issue a new short URL | `create_link` |
| List existing links (paginated) | `list_links` |
| Inspect a specific slug | `get_link` |
| Delete a link | `delete_link` |
| Per-slug click stats (country / referrer / AI ratio) | `get_analytics` |
| Click-count ranking over a period | `get_top_links` |
| Site-wide AI-bot ratio and per-bot breakdown | `get_ai_stats` |

## Using `create_link`

- `url` is required. It must be an absolute URL starting with `https://` or
  `http://`. Relative paths or bare domains return 400.
- If `slug` is omitted, a 6-character base62 slug is generated automatically
  (~56.8 billion combinations, so collisions are essentially never an issue).
- When specifying a custom `slug`:
  - Allowed characters: letters, digits, hyphen (`-`), underscore (`_`).
  - Slugs starting with `api` or `mcp` are **forbidden** (they collide with
    Worker routing).
  - A duplicate slug returns 409 `LinkConflictError`. Try a different slug.
- `expiresIn` is in seconds. Omit for no expiration. Cloudflare deletes
  expired entries automatically via KV's `expirationTtl`.
  - 1 day = 86400, 1 week = 604800, 30 days = 2592000.
- After creation, surface the response's `shortUrl` to the user — the full
  URL is more useful than the slug alone.

### Expiration guidance

| Use case | Suggested `expiresIn` |
|---|---|
| Campaigns / announcements with a known end date | seconds until the event ends |
| One-off shares (used once in a chat) | 86400 (1 day) – 604800 (1 week) |
| Long-lived links (docs, profiles) | omit (no expiration) |

If the user has not asked for an expiration, **default to no expiration**.
Don't add one unprompted.

## Using the analytics tools

### `period` parameter

- Allowed values: `"1d" | "7d" | "30d" | "90d"`. Don't pass anything else.
- Default when omitted: `"7d"`.
- Map natural-language phrases:
  - "today" / "yesterday" → `1d`
  - "last week" / "past week" → `7d`
  - "this month" / "past month" → `30d`
  - "this quarter" / "past 3 months" → `90d`
- Arbitrary windows (e.g. 14 days) are not supported. Use the next-larger
  preset (`30d`) and tell the user the result is not filtered to exactly 14
  days.

### Reading `get_analytics`

The response includes:

- `totalClicks` / `aiClicks` / `humanClicks` — split between AI and humans.
- `uniqueCountries` — number of distinct source countries.
- `topReferers` — top referrers, with `referer` and `clicks`.
- `topCountries` — top countries, with `country` and `clicks`.

When summarizing for the user, don't just dump the numbers — call out
**notable patterns or skews** (e.g. "AI traffic is unusually high at 30%",
"JP and US together account for 70%").

### `get_top_links`

`limit` defaults to 10. If the user says "top 5", pass `limit: 5`. The
returned `links` array contains slugs and click counts only — pair it with
parallel `get_link` calls when you need URLs to display.

### `get_ai_stats`

`aiRatio` is a fraction between 0 and 1; **convert to a percentage** when
showing it (`0.09` → `9%`). `byBot` lists bot names (`GPTBot`,
`ClaudeBot`, `PerplexityBot`, etc.) with click counts. Bots with zero hits
may be omitted.

## Error handling

| Error | Cause | Action |
|---|---|---|
| `LinkValidationError` | Malformed URL or slug | Re-check input with the user |
| `LinkConflictError` | Slug already exists | Suggest a different slug or fall back to auto-generation |
| `LinkNotFoundError` | Slug does not exist | Run `list_links` to find a valid slug, then retry |
| `429 Too Many Requests` | Exceeded 120 req / 60 s per IP | Honor `Retry-After`; for batch work, slow down |
| `Analytics query is not configured` | `CF_ACCOUNT_ID` / `CF_ANALYTICS_TOKEN` not set | Ask the operator to configure those Worker secrets |

## Batch tips

- Bulk shortening: parallel `create_link` calls are fine, but you'll trip
  rate limits past a few dozen — switch to sequential calls with small
  pauses for larger batches.
- Full enumeration: `list_links` is cursor-paginated. Loop until `cursor`
  stops appearing in the response.
- Top-link details: the canonical pattern is `get_top_links` followed by
  parallel `get_link` calls for each slug.

## Don't

- Suggest slugs starting with `api`, `mcp`, `authorize`, `token`, `register`,
  or `oauth` — they collide with Worker routing and always fail.
- Add `expiresIn` unprompted — default to no expiration unless the user
  asks.
- Pass undocumented `period` values like `"14d"` or `"1m"`.
- Retry on 401 silently — prompt the user to reauthorize the MCP client
  (sign in again via OAuth). On 503, the Worker's IdP configuration
  (`CF_ACCESS_*` or `OIDC_*`) is incomplete; tell the operator to check it.
