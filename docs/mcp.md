# MCP サーバー

Open Shortlink は Cloudflare Worker 上で Remote MCP サーバーとして動作する。Web UI の代わりに、AI アシスタント経由でリンク管理と分析を行う。

すべての REST API 操作（リンク CRUD、クリック統計、時系列、トップ、AI 統計）は MCP ツールとして公開されており、**Web UI を介さず AI エージェントと MCP サーバーだけで完結**する。

## エンドポイント

- URL: `https://your-shortlink.workers.dev/mcp`
- トランスポート: Streamable HTTP (MCP spec `2025-06-18` / `2025-03-26` / `2024-11-05`)
- 認証: `Authorization: Bearer <API_TOKEN>` ヘッダー
- `POST /mcp` が JSON-RPC、`GET /mcp` が server info、`DELETE /mcp` は 405（ステートレス）

## クライアント設定

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json`
（Windows は `%APPDATA%\Claude\claude_desktop_config.json`）に以下を追加:

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

設定後、Claude Desktop を再起動するとチャット画面右下のツールアイコンに
`shortlink` が表示される。

### Claude Code (CLI)

```bash
claude mcp add --transport http shortlink \
  https://your-shortlink.workers.dev/mcp \
  --header "Authorization: Bearer <API_TOKEN>"
```

またはプロジェクトルートに `.mcp.json` を作成:

```json
{
  "mcpServers": {
    "shortlink": {
      "type": "http",
      "url": "https://your-shortlink.workers.dev/mcp",
      "headers": {
        "Authorization": "Bearer <API_TOKEN>"
      }
    }
  }
}
```

`claude mcp list` で接続状態を確認できる。

### ChatGPT (Developer mode / Connectors)

ChatGPT は ChatGPT Pro / Business / Enterprise で Remote MCP サーバーを
**Connector** として追加できる（Developer mode 有効化時）。

1. Settings → Connectors → **Add custom connector**
2. 以下を入力:
   - **Name**: `Open Shortlink`
   - **MCP Server URL**: `https://your-shortlink.workers.dev/mcp`
   - **Authentication**: `Custom headers` を選び
     `Authorization: Bearer <API_TOKEN>` を追加
3. 保存すると Tools メニューから `shortlink` ツールを有効化できる

> Connector 機能が利用できないプラン（Free / Plus）の場合は、
> REST API を **Custom GPT の Actions (OpenAPI)** として登録する方法でも同等の操作が可能。
> `Authentication` に `API Key / Bearer` を設定し、`/api/links` と
> `/api/analytics/*` の各エンドポイントを OpenAPI スキーマで定義する。

### Cursor / Windsurf / その他の MCP クライアント

Streamable HTTP 準拠のクライアントであれば、同じ `url` + `headers` 形式で
接続できる。クライアントごとの設定ファイル場所は各ドキュメントを参照。

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

#### `get_timeseries`

特定の slug の時系列クリックデータを取得する。

| パラメータ | 型 | 必須 | 説明 |
|---|---|---|---|
| `slug` | string | Yes | 対象の slug |
| `period` | string | No | 集計期間（`1d`, `7d`, `30d`, `90d`。デフォルト: `7d`） |
| `interval` | string | No | 集計間隔（`1h`, `1d`。デフォルト: `1d`） |

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

「abc123 の先月の日別推移をグラフにしたい」
→ get_timeseries(slug: "abc123", period: "30d", interval: "1d")

「AI からのアクセスはどれくらい？」
→ get_ai_stats(period: "30d")
```
