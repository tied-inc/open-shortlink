# MCP Server

Open Shortlink runs on Cloudflare Workers as a Remote MCP server. Instead of a Web UI, you manage links and analytics through an AI assistant.

All REST API operations (link CRUD, click stats, time series, top links, AI stats) are exposed as MCP tools, so **everything can be done through an AI agent and the MCP server alone, without a Web UI**.

## Endpoint

- URL: `https://your-shortlink.workers.dev/mcp`
- Transport: Streamable HTTP (MCP spec `2025-06-18` / `2025-03-26` / `2024-11-05`)
- Authentication: OAuth 2.1 (PKCE + dynamic client registration)
- `POST /mcp` is JSON-RPC, `GET /mcp` returns server info, `DELETE /mcp` returns 405 (stateless)

### OAuth endpoints

The following endpoints are provided automatically for OAuth-capable clients
like Claude Desktop:

| Path | Description |
|---|---|
| `/.well-known/oauth-authorization-server` | OAuth metadata (RFC 8414) |
| `/.well-known/oauth-protected-resource` | Protected resource metadata (RFC 9728) |
| `/authorize` | Delegates sign-in to the operator-configured IdP |
| `/oauth/callback` | Return URL from the upstream IdP in OIDC mode |
| `/token` | Token exchange |
| `/register` | Dynamic client registration (RFC 7591) |

The behavior of `/authorize` depends on the operator-configured IdP:

- **Cloudflare Access mode**: Verifies the JWT issued by Access. If allowed,
  completes OAuth authorization directly
- **Generic OIDC mode**: Generates PKCE + state + nonce and redirects (302)
  to the upstream IdP authorization endpoint. After upstream sign-in, returns
  to `/oauth/callback`, verifies the ID token via JWKS, and then completes
  OAuth authorization

## Client setup

### Claude Desktop

You can connect via OAuth from Claude Desktop's "Add custom connector" GUI.

1. Claude Desktop → **Settings** → **Add custom connector**
2. Enter the following:
   - **Name**: `Open Shortlink`
   - **Remote MCP server URL**: `https://your-shortlink.workers.dev/mcp`
   - **OAuth Client ID / OAuth Client Secret**: Leave blank
3. Click **Add**

On first connect, your browser opens and redirects to the sign-in screen of
the IdP configured on the Worker side (Cloudflare Access or any OpenID Connect
provider). After signing in with an allowed email / sub, the OAuth flow
completes automatically and `shortlink` appears in the tool icon at the
bottom right of the Claude Desktop chat.

::: tip Access token lifetime
Access tokens expire after 1 hour and refresh tokens after 30 days. When
they expire, the re-authorization flow runs automatically.
:::

### Claude Code (CLI)

```bash
claude mcp add --transport http shortlink \
  https://your-shortlink.workers.dev/mcp
```

Or create a `.mcp.json` at your project root:

```json
{
  "mcpServers": {
    "shortlink": {
      "type": "http",
      "url": "https://your-shortlink.workers.dev/mcp"
    }
  }
}
```

The OAuth authorization flow runs in your browser on first connect.
Run `claude mcp list` to check connection status.

### Other MCP clients

Any Streamable HTTP client that supports OAuth 2.1 (PKCE + dynamic client
registration) can connect. Fetch the metadata from
`/.well-known/oauth-authorization-server` and start the OAuth flow.

## Tool list

### Link management

#### `create_link`

Create a short URL.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | The URL to shorten |
| `slug` | string | No | Custom slug |
| `expiresIn` | number | No | Expiration in seconds |

#### `list_links`

List links.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `limit` | number | No | Number of items (default: 20) |
| `cursor` | string | No | Pagination cursor |

#### `get_link`

Get details of a specific link.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | Yes | The target slug |

#### `delete_link`

Delete a link.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | Yes | The target slug |

### Analytics

#### `get_analytics`

Get click statistics for a specific slug.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | Yes | The target slug |
| `period` | string | No | Aggregation period (`1d`, `7d`, `30d`, `90d`. Default: `7d`) |

#### `get_timeseries`

Get time series click data for a specific slug.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `slug` | string | Yes | The target slug |
| `period` | string | No | Aggregation period (`1d`, `7d`, `30d`, `90d`. Default: `7d`) |
| `interval` | string | No | Aggregation interval (`1h`, `1d`. Default: `1d`) |

#### `get_top_links`

Get the most-clicked links ranking.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `period` | string | No | Aggregation period (default: `7d`) |
| `limit` | number | No | Number of items (default: 10) |

#### `get_ai_stats`

Get AI access statistics.

| Parameter | Type | Required | Description |
|---|---|---|---|
| `period` | string | No | Aggregation period (default: `7d`) |

## Usage examples

```
"Shorten https://example.com/long-article"
→ create_link(url: "https://example.com/long-article")

"Register https://example.com/blog with slug 'blog' and 30-day expiration"
→ create_link(url: "https://example.com/blog", slug: "blog", expiresIn: 2592000)

"Show me the top 5 most-clicked links last week"
→ get_top_links(period: "7d", limit: 5)

"Tell me the per-country access for abc123"
→ get_analytics(slug: "abc123", period: "30d")

"I want to graph the daily trend of abc123 last month"
→ get_timeseries(slug: "abc123", period: "30d", interval: "1d")

"How much access is from AI?"
→ get_ai_stats(period: "30d")
```
