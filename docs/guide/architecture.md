# アーキテクチャ

## 概要

Open Shortlink は Cloudflare Workers 上で動作する単一の Worker アプリケーション。リダイレクト、REST API、MCP サーバーのすべてが 1 つの Worker に統合されている。

```
┌─────────────────────────────────────────────────┐
│                Cloudflare Workers                │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Redirect │  │ REST API │  │  MCP Server   │  │
│  │ GET /:slug│  │ /api/*   │  │  /mcp         │  │
│  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │                │          │
│       ▼              ▼                ▼          │
│  ┌─────────────────────────────────────────┐     │
│  │           共通ビジネスロジック            │     │
│  │  (リンク管理 / 分析 / slug生成 / 認証)   │     │
│  └──────┬──────────────────┬───────────────┘     │
│         │                  │                     │
│         ▼                  ▼                     │
│  ┌────────────┐    ┌─────────────────┐           │
│  │     KV     │    │ Analytics Engine│           │
│  │ slug→URL   │    │ クリックデータ   │           │
│  └────────────┘    └─────────────────┘           │
└─────────────────────────────────────────────────┘
```

## テックスタック

| レイヤー | 技術 | 選定理由 |
|---|---|---|
| フレームワーク | Hono | 軽量、Workers ネイティブ対応、型安全 |
| 言語 | TypeScript | 型安全性、開発体験 |
| パッケージマネージャー | Bun | 高速、TypeScript ネイティブ |
| リダイレクト用ストレージ | Cloudflare KV | key-value 検索に最適、エッジ読み取り、無料枠大 |
| 分析 | Cloudflare Analytics Engine | 非同期書込み、SQL クエリ対応、無料枠大 |
| MCP | Remote MCP (SSE) | Worker 内蔵、別サーバー不要 |

## リクエストフロー

### リダイレクト（ホットパス）

```
ユーザー → GET /:slug
  → KV.get(slug)
  → URL が見つかれば 302 Redirect
  → Analytics Engine にクリックデータを非同期書込み
  → URL が見つからなければ 404
```

リダイレクトは認証不要。Analytics Engine への書込みは `waitUntil()` で非同期実行するため、レスポンスのレイテンシに影響しない。

### API / MCP 操作

```
クライアント → POST /api/links (Bearer token)
  → URL バリデーション
  → slug 生成（またはカスタムスラッグの重複チェック）
  → KV.put(slug, url, { expirationTtl? })
  → 201 Created
```

## ストレージ設計

### KV（リダイレクト用）

```
Key:      slug (例: "abc123")
Value:    対象 URL (例: "https://example.com/very/long/path")
Metadata: { createdAt: number, expiresAt?: number }
```

- KV の `expirationTtl` で有効期限を実現（Cloudflare が自動削除）
- リダイレクトは `KV.get()` 1 回で完結

### Analytics Engine（分析用）

各クリックで以下のデータポイントを記録:

| フィールド | 型 | 内容 |
|---|---|---|
| blob1 | string | slug |
| blob2 | string | リファラー |
| blob3 | string | 国コード（`cf.country` から取得） |
| blob4 | string | User-Agent |
| blob5 | string | AI フラグ (`"ai"` or `"human"`) |
| double1 | number | タイムスタンプ |

## 認証

- **リダイレクトエンドポイント** (`GET /:slug`): 認証なし
- **API エンドポイント** (`/api/*`): Bearer token 認証
- **MCP エンドポイント** (`/mcp`): Bearer token 認証

token は環境変数 `API_TOKEN` で設定。シングルテナント前提のため、ユーザー管理は不要。

## プロジェクト構成

```
open-shortlink/
├── src/
│   ├── index.ts              # Hono アプリ + MCP エンドポイント
│   ├── routes/
│   │   ├── redirect.ts       # GET /:slug → 302
│   │   └── api.ts            # REST API (CRUD + 分析)
│   ├── mcp/
│   │   └── tools.ts          # MCP ツール定義
│   ├── analytics/
│   │   ├── tracker.ts        # Analytics Engine への書込み
│   │   └── ai-detector.ts    # AI User-Agent 判定
│   ├── storage/
│   │   └── kv.ts             # Cloudflare KV 操作
│   └── lib/
│       ├── slug.ts           # NanoID ベース slug 生成
│       └── validate.ts       # URL バリデーション
├── docs/                     # VitePress ドキュメントサイト
├── wrangler.toml
├── package.json
└── tsconfig.json
```
