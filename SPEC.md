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
| リダイレクト用ストレージ | Cloudflare KV（geo バリアント対応） |
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

| 変数名 | 説明 | 設定方法 |
|---|---|---|
| `API_TOKEN` | API / MCP 認証用 Bearer token | `wrangler secret put API_TOKEN` |

## ストレージ設計

### KV

```
Key:      slug (例: "abc123")
Value:    対象 URL (例: "https://example.com/very/long/path")
          または geo 付きの場合は JSON エンベロープ
          { "u": "https://example.com", "g": { "US": "...", "JP": "..." } }
Metadata: { createdAt: number, expiresAt?: number, url?: string }
```

- `expirationTtl` で有効期限を実現（Cloudflare が自動削除）
- geo バリアントが無いリンクは value を生の URL として保存（後方互換）

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
  "expiresIn": 86400,        // optional, 秒。省略時は無期限
  "geo": {                   // optional, 国別リダイレクト先
    "US": "https://example.com/en",
    "JP": "https://example.com/ja"
  }
}
```

- `geo` のキーは ISO 3166-1 alpha-2（2 文字大文字）。小文字入力は大文字へ正規化
- `geo` のいずれかの値が不正 URL / 自ホスト向けなら 400
- `geo` に一致する国コードが無い場合は `url`（デフォルト）にフォールバック

レスポンス (201):
```json
{
  "slug": "abc123",
  "url": "https://example.com/path",
  "geo": { "US": "...", "JP": "..." },  // geo 指定時のみ
  "shortUrl": "https://your-domain.com/abc123",
  "createdAt": "2025-01-01T00:00:00Z",
  "expiresAt": "2025-01-02T00:00:00Z"
}
```

エラー:
- 400: URL 不正 / スラッグ無効 / geo キー不正 / geo URL 不正
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
- カスタムスラッグ: 英数字、ハイフン、アンダースコア許可。先頭に `api` や `mcp` は禁止（ルーティング衝突防止）

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
- 認証失敗時: 401 Unauthorized

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
  → caches.default.match(req)
  → HIT → 302 (cached) + waitUntil(Analytics Engine 書込み)
  → MISS → KV.get(slug)
        → 見つからない → 404
        → geo なし → 302 + waitUntil(cache.put + Analytics 書込み)
        → geo あり → request.cf.country でルックアップ、ヒットしなければ
                     デフォルト URL にフォールバック。`Cache-Control:
                     private, no-store` を付与しエッジ/ブラウザ共にキャッシュ
                     させない + waitUntil(Analytics 書込み)
```

- エッジキャッシュのキーはリクエスト URL のみで国情報を含まないため、geo
  バリアントを持つリンクはキャッシュに書き込まない。書き込まない以上、ヒット
  したレスポンスは常に geo 非対応のものと保証できる
- 非 geo リンクは従来どおり `public, s-maxage=60` で colo キャッシュに載せる
- Analytics Engine への書込みは `waitUntil()` で非同期。レスポンスレイテンシに影響しない

### geo バリアントの注意点

- 国判定は `request.cf.country`（Cloudflare 決定）。VPN・モバイル回線などで
  実住所と乖離することがある
- 少数バリアントの想定：すべての国を列挙する必要はなく、出し分けたい国のみ
  指定してその他はデフォルトにフォールバックする設計
- Accept-Language ベースの出し分けはランディング側で行う前提。短縮リンク側は
  国ベースの粗い振り分けに特化

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
