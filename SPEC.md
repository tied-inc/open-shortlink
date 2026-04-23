# Open Shortlink 仕様書

## 概要

オープンソースの URL 短縮サービス。Cloudflare Workers 上で動作し、無料枠の範囲で運用可能。

## 設計方針

- **シングルテナント**: ユーザー管理なし。必要な人が fork して自分の Cloudflare にデプロイする
- **低コスト**: Cloudflare 無料枠で月額 $0 運用が可能
- **AI ネイティブ**: Web UI なし。REST API と Remote MCP サーバーで管理
- **単一 Worker**: リダイレクト・API・MCP サーバーをすべて 1 つの Worker に統合

## テックスタック

| レイヤー | 技術 |
|---|---|
| フレームワーク | Hono |
| 言語 | TypeScript |
| パッケージマネージャー | Bun |
| リダイレクト用ストレージ | Cloudflare KV |
| 分析 | Cloudflare Analytics Engine |
| MCP | Remote MCP (Worker 内蔵) |
| ドキュメント | VitePress (GitHub Pages) |

## Cloudflare リソース

| リソース | バインディング名 | 用途 | 無料枠 |
|---|---|---|---|
| Workers | — | アプリケーション実行 | 10万リクエスト/日 |
| KV | `SHORTLINKS` | slug → URL マッピング | 読取10万/日, 書込1k/日 |
| Analytics Engine | `ANALYTICS` | クリックデータ記録 | 書込10万/日, 読取1万クエリ/日 |

## 環境変数

| 変数名 | 必須 | 説明 | 設定方法 |
|---|---|---|---|
| `API_TOKEN` | ◯ | API / MCP 認証用 Bearer token。24文字以上、かつ `dev-token-change-me` などの既知プレースホルダは拒否。 | `wrangler secret put API_TOKEN` |
| `CF_ACCOUNT_ID` | 分析API使用時 | Cloudflare アカウント ID | `wrangler secret put CF_ACCOUNT_ID` |
| `CF_ANALYTICS_TOKEN` | 分析API使用時 | Analytics Engine 読み取り権限付き API トークン | `wrangler secret put CF_ANALYTICS_TOKEN` |
| `CORS_ALLOW_ORIGIN` | 任意 | カンマ区切りの CORS allowlist。未設定または `*` で全許可。 | `wrangler secret put CORS_ALLOW_ORIGIN` |

## ストレージ設計

### KV

```
Key:      slug (例: "abc123")
Value:    対象 URL (例: "https://example.com/very/long/path")
Metadata: { createdAt: number, expiresAt?: number }
```

- `expirationTtl` で有効期限を実現（Cloudflare が自動削除）

### Analytics Engine

| カラム | 型 | 内容 |
|---|---|---|
| blob1 | string | slug |
| blob2 | string | リファラー |
| blob3 | string | 国コード（`request.cf.country`） |
| blob4 | string | User-Agent |
| blob5 | string | AI フラグ (`"ai"` / `"human"`) |
| double1 | number | タイムスタンプ (Unix ms) |

## エンドポイント

### リダイレクト（認証なし）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/:slug` | 302 リダイレクト。KV から URL を取得し、Analytics Engine にクリックデータを非同期記録 |

### リンク管理 API（Bearer token 認証）

| メソッド | パス | 説明 |
|---|---|---|
| POST | `/api/links` | 短縮 URL 作成 |
| GET | `/api/links` | リンク一覧（cursor ページネーション） |
| GET | `/api/links/:slug` | リンク詳細 |
| DELETE | `/api/links/:slug` | リンク削除 |

### 分析 API（Bearer token 認証）

| メソッド | パス | 説明 |
|---|---|---|
| GET | `/api/analytics/:slug` | slug 別クリック統計 |
| GET | `/api/analytics/:slug/timeseries` | 時系列データ |
| GET | `/api/analytics/top` | トップリンク |
| GET | `/api/analytics/ai` | AI アクセス統計 |

### MCP（Bearer token 認証）

| パス | 説明 |
|---|---|
| `/mcp` | Remote MCP サーバーエンドポイント |

## API 詳細

### POST /api/links

リクエスト:
```json
{
  "url": "https://example.com/path",
  "slug": "custom-slug",    // optional, 省略時は6文字自動生成
  "expiresIn": 86400         // optional, 秒。省略時は無期限
}
```

レスポンス (201):
```json
{
  "slug": "abc123",
  "url": "https://example.com/path",
  "shortUrl": "https://your-domain.com/abc123",
  "createdAt": "2025-01-01T00:00:00Z",
  "expiresAt": "2025-01-02T00:00:00Z"
}
```

エラー:
- 400: URL 不正 / スラッグ無効
- 409: スラッグ重複

### GET /api/links

クエリ: `?limit=20&cursor=xxx`

レスポンス (200):
```json
{
  "links": [{ "slug", "url", "shortUrl", "createdAt", "expiresAt" }],
  "cursor": "next-page-cursor"
}
```

### GET /api/links/:slug

レスポンス (200): リンクオブジェクト
エラー: 404

### DELETE /api/links/:slug

レスポンス: 204
エラー: 404

### GET /api/analytics/:slug

クエリ: `?period=7d` (1d, 7d, 30d, 90d)

レスポンス (200):
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

クエリ: `?period=7d&interval=1d` (interval: 1h, 1d)

レスポンス (200):
```json
{
  "slug": "abc123",
  "period": "7d",
  "interval": "1d",
  "data": [{ "timestamp": "ISO8601", "clicks": 150, "aiClicks": 10 }]
}
```

### GET /api/analytics/top

クエリ: `?period=7d&limit=10`

レスポンス (200):
```json
{
  "period": "7d",
  "links": [{ "slug": "abc123", "url": "https://...", "clicks": 1234 }]
}
```

### GET /api/analytics/ai

クエリ: `?period=7d`

レスポンス (200):
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

## MCP ツール

| ツール名 | 説明 | 対応 API |
|---|---|---|
| `create_link` | 短縮 URL 作成 | POST /api/links |
| `list_links` | リンク一覧 | GET /api/links |
| `get_link` | リンク詳細 | GET /api/links/:slug |
| `delete_link` | リンク削除 | DELETE /api/links/:slug |
| `get_analytics` | slug 別統計 | GET /api/analytics/:slug |
| `get_top_links` | トップリンク | GET /api/analytics/top |
| `get_ai_stats` | AI アクセス統計 | GET /api/analytics/ai |

## Slug 生成

- NanoID ベースの base62 (a-z, A-Z, 0-9)
- デフォルト長: 6文字 (62^6 ≒ 568億パターン)
- カスタムスラッグ: 英数字、ハイフン、アンダースコア許可 (最大64文字)
- 予約済み: `api`, `mcp` プレフィックス（ルーティング衝突防止）および `health`, `healthz`, `ready`, `readyz`, `metrics`, `favicon.ico`, `robots.txt`, `sitemap.xml`, `.well-known`（将来の well-known パス用）

## AI User-Agent 判定

以下のパターンを含む User-Agent を AI アクセスと判定:

```
GPTBot, ChatGPT-User, ClaudeBot, Claude-Web,
PerplexityBot, Bytespider, Applebot-Extended,
Google-Extended, CCBot, anthropic-ai, cohere-ai,
meta-externalagent
```

## 認証

- リダイレクトエンドポイント (`GET /:slug`): 認証なし
- API (`/api/*`) / MCP (`/mcp`): `Authorization: Bearer <API_TOKEN>` ヘッダー必須
- 認証失敗時: 401 Unauthorized（`WWW-Authenticate: Bearer realm="open-shortlink"` 付与）
- 比較は定数時間比較で実施（タイミング攻撃耐性）
- `API_TOKEN` が未設定または弱い（24文字未満・既知プレースホルダ）場合、サーバーは 503 を返して起動を拒否する

## セキュリティ対策

- **URL バリデーション**: 短縮対象 URL は HTTP(S) のみ許可し、次のホストは拒否:
  - `localhost`, `*.local`, `*.internal`, `*.localhost`, `*.onion` などの内部 TLD
  - ループバック (`127.0.0.0/8`, `::1`)
  - RFC1918 プライベート範囲 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`)
  - リンクローカル (`169.254.0.0/16`, `fe80::/10`) ※ クラウドメタデータ `169.254.169.254` を含む
  - CGNAT (`100.64.0.0/10`)
  - マルチキャスト (`224.0.0.0/4`) / 予約 (`240.0.0.0/4`)
  - IPv6 ULA (`fc00::/7`) / マルチキャスト (`ff00::/8`) / IPv4-mapped (`::ffff:*`) / NAT64
  - 埋め込み認証情報 (`user:pass@host`)
  - 2048 文字を超える URL
- **Slug バリデーション**: `/:slug` および Analytics 系エンドポイントで `isValidSlug` を適用。`api`, `mcp` プレフィックスに加え、`health`, `metrics` などの予約パスを禁止。
- **HTTP セキュリティヘッダー**: 全レスポンスに `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Strict-Transport-Security`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `Permissions-Policy` を付与。
- **レート制限**: 信頼できる `cf-connecting-ip` のみをキーに使用（`x-forwarded-for` は受信しない）。
- **リクエストボディ上限**: `POST /api/links` は 16KiB、`POST /mcp` は 256KiB。
- **エラーメッセージ**: MCP の内部エラーは `tool execution failed` として外部露出せず、詳細はサーバログのみに出力。

## レート制限

- Worker 組込み (`src/middleware/rate-limit.ts`): `/api/*` と `/mcp`, `/mcp/*` に
  対して IP 単位、既定 60 秒あたり 120 リクエスト
- 状態は Worker isolate ごと。グローバルリミットではなく、**isolate に対する
  バースト防止のセーフティネット**として機能する
- 超過時は `429 Too Many Requests` を返し、`Retry-After` / `X-RateLimit-Limit`
  / `X-RateLimit-Remaining` / `X-RateLimit-Reset` を付与する
- グローバル enforcement は Cloudflare Rate Limiting Rules（ダッシュボード）で
  行う方針。設定手順は `docs/guide/deploy.md` を参照

## リクエストフロー

### リダイレクト
```
GET /:slug
  → KV.get(slug)
  → 見つかった → 302 redirect + waitUntil(Analytics Engine 書込み)
  → 見つからない → 404
```

Analytics Engine への書込みは `waitUntil()` で非同期。レスポンスレイテンシに影響しない。

## デプロイ

- **Deploy to Cloudflare ボタン**: README に配置。ワンクリックで fork + デプロイ
- **手動**: `wrangler deploy`
- **CI/CD**: GitHub Actions (`main` push で自動デプロイ)
- **ドキュメント**: GitHub Pages (VitePress)

## プロジェクト構成

```
open-shortlink/
├── src/
│   ├── index.ts              # Hono アプリ エントリポイント
│   ├── routes/
│   │   ├── redirect.ts       # GET /:slug → 302
│   │   └── api.ts            # REST API (CRUD + 分析)
│   ├── mcp/
│   │   └── tools.ts          # MCP ツール定義
│   ├── analytics/
│   │   ├── tracker.ts        # Analytics Engine 書込み
│   │   └── ai-detector.ts    # AI User-Agent 判定
│   ├── storage/
│   │   └── kv.ts             # Cloudflare KV 操作
│   └── lib/
│       ├── slug.ts           # NanoID ベース slug 生成
│       └── validate.ts       # URL バリデーション
├── docs/                     # VitePress ドキュメント
├── .github/workflows/
│   ├── deploy.yml            # Worker デプロイ
│   └── docs.yml              # ドキュメントデプロイ
├── wrangler.toml
├── package.json
└── tsconfig.json
```
