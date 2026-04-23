# MCP サーバー

Open Shortlink は Cloudflare Worker 上で Remote MCP サーバーとして動作する。Web UI の代わりに、AI アシスタント経由でリンク管理と分析を行う。

## 接続設定

Claude Desktop やその他の MCP クライアントに以下を設定:

```json
{
  "mcpServers": {
    "shortlink": {
      "type": "url",
      "url": "https://your-shortlink.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <API_TOKEN>"
      }
    }
  }
}
```

## ツール一覧

### リンク管理

#### `create_link`

短縮 URL を作成する。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `url` | string | Yes | 短縮対象の URL |
| `slug` | string | No | カスタムスラッグ |
| `expiresIn` | number | No | 有効期限（秒） |

#### `list_links`

リンクの一覧を取得する。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `limit` | number | No | 取得件数（デフォルト: 20） |
| `cursor` | string | No | ページネーション用カーソル |

#### `get_link`

特定のリンクの詳細を取得する。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `slug` | string | Yes | 対象の slug |

#### `delete_link`

リンクを削除する。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `slug` | string | Yes | 対象の slug |

### 分析

#### `get_analytics`

特定の slug のクリック統計を取得する。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `slug` | string | Yes | 対象の slug |
| `period` | string | No | 集計期間（`1d`, `7d`, `30d`, `90d`。デフォルト: `7d`） |

#### `get_top_links`

クリック数の多いリンクのランキングを取得する。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `period` | string | No | 集計期間（デフォルト: `7d`） |
| `limit` | number | No | 取得件数（デフォルト: 10） |

#### `get_ai_stats`

AI アクセスの統計を取得する。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `period` | string | No | 集計期間（デフォルト: `7d`） |

## 使い方の例

```
「https://example.com/long-article を短縮して」
→ create_link(url: "https://example.com/long-article")

「blog という slug で https://example.com/blog を登録して、30日で期限切れにして」
→ create_link(url: "https://example.com/blog", slug: "blog", expiresIn: 2592000)

「先週のクリック数トップ 5 を見せて」
→ get_top_links(period: "7d", limit: 5)

「abc123 の国別アクセスを教えて」
→ get_analytics(slug: "abc123", period: "30d")

「AI からのアクセスはどれくらい？」
→ get_ai_stats(period: "30d")
```
