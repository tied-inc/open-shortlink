# MCP サーバー

Open Shortlink は Cloudflare Worker 上で Remote MCP サーバーとして動作する。Web UI の代わりに、AI アシスタント経由でリンク管理と分析を行う。

すべての REST API 操作（リンク CRUD、クリック統計、時系列、トップ、AI 統計）は MCP ツールとして公開されており、**Web UI を介さず AI エージェントと MCP サーバーだけで完結**する。

## エンドポイント

- URL: `https://your-shortlink.workers.dev/mcp`
- トランスポート: Streamable HTTP (MCP spec `2025-06-18` / `2025-03-26` / `2024-11-05`)
- 認証: OAuth 2.1（PKCE + 動的クライアント登録）
- `POST /mcp` が JSON-RPC、`GET /mcp` が server info、`DELETE /mcp` は 405（ステートレス）

### OAuth エンドポイント

Claude Desktop などの OAuth 対応クライアント向けに以下のエンドポイントが
自動的に提供される:

| パス | 説明 |
|---|---|
| `/.well-known/oauth-authorization-server` | OAuth メタデータ (RFC 8414) |
| `/authorize` | 認可ページ（ブラウザで API Token を入力） |
| `/token` | トークン交換 |
| `/register` | 動的クライアント登録 (RFC 7591) |

## クライアント設定

### Claude Desktop

Claude Desktop の「カスタムコネクタを追加」GUI から OAuth で接続できる。

1. Claude Desktop → **設定** → **カスタムコネクタを追加**
2. 以下を入力:
   - **名前**: `Open Shortlink`
   - **リモート MCP サーバー URL**: `https://your-shortlink.workers.dev/mcp`
   - **OAuth Client ID / OAuth クライアントシークレット**: 空欄のまま
3. **追加** をクリック

初回接続時にブラウザが開き、認可ページが表示される。デプロイ時に設定した
**API Token** を入力して **Authorize** をクリックすると、OAuth フローが
完了し、Claude Desktop のチャット画面右下のツールアイコンに `shortlink` が
表示される。

::: tip アクセストークンの有効期限
アクセストークンは 1 時間、リフレッシュトークンは 30 日で有効期限切れに
なる。期限切れ時は自動的に再認証フローが走る。
:::

### Claude Code (CLI)

```bash
claude mcp add --transport http shortlink \
  https://your-shortlink.workers.dev/mcp
```

またはプロジェクトルートに `.mcp.json` を作成:

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

初回接続時にブラウザで OAuth 認可フローが走る。
`claude mcp list` で接続状態を確認できる。

### その他の MCP クライアント

OAuth 2.1（PKCE + 動的クライアント登録）に対応した Streamable HTTP
クライアントであれば接続できる。`/.well-known/oauth-authorization-server`
からメタデータを取得し、OAuth フローを開始する。

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
