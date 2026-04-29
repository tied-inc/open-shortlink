# API Reference

All API endpoints require an OAuth 2.1 access token (except for redirects).

```
Authorization: Bearer <OAUTH_ACCESS_TOKEN>
```

Access tokens are obtained through the OAuth 2.1 flow (`/authorize` → IdP sign-in → `/token`). They are acquired and refreshed automatically when connecting via MCP from Claude Desktop or Claude Code, so you don't need to think about them when going through MCP. If you call the API directly with curl etc., complete the authorization flow first via Claude Desktop or similar, then use the issued access token. See the [Security Policy](./guide/security) for details.

## Redirect

### `GET /:slug`

Redirects from the short URL to the original URL. No authentication required.

**Response:**

| Status | Description |
|---|---|
| 302 Found | Redirects with the original URL set in the `Location` header |
| 404 Not Found | The slug does not exist or has expired |

---

## Link management

### `POST /api/links`

Create a short URL.

**Request body:**

```json
{
  "url": "https://example.com/very/long/path",
  "slug": "my-custom-slug",
  "expiresIn": 86400,
  "geo": {
    "US": "https://example.com/en",
    "JP": "https://example.com/ja"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `url` | string | Yes | The URL to shorten (default / fallback) |
| `slug` | string | No | Custom slug. If omitted, a 6-character slug is generated automatically |
| `expiresIn` | number | No | Expiration in seconds. If omitted, the link does not expire |
| `geo` | object | No | Per-country redirect destinations. Keys are ISO 3166-1 alpha-2 codes (e.g. `US`, `JP`), values are URLs. Countries not listed fall back to `url` |

**Response:** `201 Created`

```json
{
  "slug": "abc123",
  "url": "https://example.com/very/long/path",
  "geo": {
    "US": "https://example.com/en",
    "JP": "https://example.com/ja"
  },
  "shortUrl": "https://your-domain.com/abc123",
  "createdAt": "2025-01-01T00:00:00Z",
  "expiresAt": "2025-01-02T00:00:00Z"
}
```

> Links with `geo` set get `Cache-Control: private, no-store` and are not stored in edge or browser caches (to prevent misdelivery from cache keys that don't include the country code).

**Errors:**

| Status | Description |
|---|---|
| 400 Bad Request | Invalid URL, invalid slug, or invalid `geo` keys/values |
| 409 Conflict | The specified slug is already in use |

### `GET /api/links`

List links.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `limit` | number | 20 | Number of items to return (max 100) |
| `cursor` | string | — | Pagination cursor |

**Response:** `200 OK`

```json
{
  "links": [
    {
      "slug": "abc123",
      "url": "https://example.com/very/long/path",
      "shortUrl": "https://your-domain.com/abc123",
      "createdAt": "2025-01-01T00:00:00Z",
      "expiresAt": null
    }
  ],
  "cursor": "next-page-cursor"
}
```

### `GET /api/links/:slug`

Get details of a specific link.

**Response:** `200 OK`

```json
{
  "slug": "abc123",
  "url": "https://example.com/very/long/path",
  "shortUrl": "https://your-domain.com/abc123",
  "createdAt": "2025-01-01T00:00:00Z",
  "expiresAt": null
}
```

### `DELETE /api/links/:slug`

Delete a link.

**Response:** `204 No Content`

---

## Analytics

### `GET /api/analytics/:slug`

Get click statistics for a specific slug.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `period` | string | `7d` | Aggregation period (`1d`, `7d`, `30d`, `90d`) |

**Response:** `200 OK`

```json
{
  "slug": "abc123",
  "period": "7d",
  "totalClicks": 1234,
  "uniqueCountries": 15,
  "aiClicks": 89,
  "humanClicks": 1145,
  "topReferers": [
    { "referer": "https://twitter.com", "clicks": 500 },
    { "referer": "https://github.com", "clicks": 200 }
  ],
  "topCountries": [
    { "country": "JP", "clicks": 800 },
    { "country": "US", "clicks": 300 }
  ]
}
```

### `GET /api/analytics/:slug/timeseries`

Get time series click data.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `period` | string | `7d` | Aggregation period |
| `interval` | string | `1d` | Aggregation interval (`1h`, `1d`) |

**Response:** `200 OK`

```json
{
  "slug": "abc123",
  "period": "7d",
  "interval": "1d",
  "data": [
    { "timestamp": "2025-01-01T00:00:00Z", "clicks": 150, "aiClicks": 10 },
    { "timestamp": "2025-01-02T00:00:00Z", "clicks": 200, "aiClicks": 15 }
  ]
}
```

### `GET /api/analytics/top`

Get the most-clicked links ranking.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `period` | string | `7d` | Aggregation period |
| `limit` | number | 10 | Number of items to return |

**Response:** `200 OK`

```json
{
  "period": "7d",
  "links": [
    { "slug": "abc123", "url": "https://example.com", "clicks": 1234 },
    { "slug": "xyz789", "url": "https://other.com", "clicks": 567 }
  ]
}
```

### `GET /api/analytics/ai`

Get AI access statistics.

**Query parameters:**

| Parameter | Type | Default | Description |
|---|---|---|---|
| `period` | string | `7d` | Aggregation period |

**Response:** `200 OK`

```json
{
  "period": "7d",
  "totalClicks": 5000,
  "aiClicks": 450,
  "humanClicks": 4550,
  "aiRatio": 0.09,
  "byBot": [
    { "bot": "GPTBot", "clicks": 200 },
    { "bot": "ClaudeBot", "clicks": 120 },
    { "bot": "PerplexityBot", "clicks": 80 }
  ]
}
```
