# API リファレンス

すべての API エンドポイントは Bearer token 認証が必要（リダイレクトを除く）。

```
Authorization: Bearer <API_TOKEN>
```

## リダイレクト

### `GET /:slug`

短縮 URL から元の URL へリダイレクトする。認証不要。

**レスポンス:**

| ステータス | 説明 |
|---|---|
| 302 Found | `Location` ヘッダーに元の URL を設定してリダイレクト |
| 404 Not Found | slug が存在しないか期限切れ |

---

## リンク管理

### `POST /api/links`

短縮 URL を作成する。

**リクエストボディ:**

```json
{
  "url": "https://example.com/very/long/path",
  "slug": "my-custom-slug",
  "expiresIn": 86400
}
```

| フィールド | 型 | 必須 | 説明 |
|---|---|---|---|
| `url` | string | Yes | 短縮対象の URL |
| `slug` | string | No | カスタムスラッグ。省略時は自動生成（6文字） |
| `expiresIn` | number | No | 有効期限（秒）。省略時は無期限 |

**レスポンス:** `201 Created`

```json
{
  "slug": "abc123",
  "url": "https://example.com/very/long/path",
  "shortUrl": "https://your-domain.com/abc123",
  "createdAt": "2025-01-01T00:00:00Z",
  "expiresAt": "2025-01-02T00:00:00Z"
}
```

**エラー:**

| ステータス | 説明 |
|---|---|
| 400 Bad Request | URL が不正、またはスラッグが無効 |
| 409 Conflict | 指定したスラッグが既に使用されている |

### `GET /api/links`

リンクの一覧を取得する。

**クエリパラメータ:**

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `limit` | number | 20 | 取得件数（最大 100） |
| `cursor` | string | — | ページネーション用カーソル |

**レスポンス:** `200 OK`

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

特定のリンクの詳細を取得する。

**レスポンス:** `200 OK`

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

リンクを削除する。

**レスポンス:** `204 No Content`

---

## 分析

### `GET /api/analytics/:slug`

特定の slug のクリック統計を取得する。

**クエリパラメータ:**

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `period` | string | `7d` | 集計期間（`1d`, `7d`, `30d`, `90d`） |

**レスポンス:** `200 OK`

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

時系列のクリックデータを取得する。

**クエリパラメータ:**

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `period` | string | `7d` | 集計期間 |
| `interval` | string | `1d` | 集計間隔（`1h`, `1d`） |

**レスポンス:** `200 OK`

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

クリック数の多いリンクのランキングを取得する。

**クエリパラメータ:**

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `period` | string | `7d` | 集計期間 |
| `limit` | number | 10 | 取得件数 |

**レスポンス:** `200 OK`

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

AI アクセスの統計を取得する。

**クエリパラメータ:**

| パラメータ | 型 | デフォルト | 説明 |
|---|---|---|---|
| `period` | string | `7d` | 集計期間 |

**レスポンス:** `200 OK`

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
