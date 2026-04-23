# クイックスタート

::: warning はじめに: 認証トークンが必須です
Open Shortlink の API/MCP は `API_TOKEN` （Bearer 認証）を設定しないと
**503** を返し続けます（fail-closed 設計）。デプロイ直後に必ずトークンを
設定してください。詳しくは [セキュリティポリシー](./security) を参照。
:::

## Deploy to Cloudflare（1 クリック）

ボタンを押すと、セットアップ画面で `API_TOKEN` の入力と Worker 名の
確認を求められます。送信すると fork → KV の自動プロビジョン →
Worker デプロイ → Secret 登録 まで一気に完了します。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tied-inc/open-shortlink)

::: warning 事前準備（初回のみ・30 秒）
**Analytics Engine データセットを 1 つ手動で作成しておいてください。**
ボタンを押す前か直後でも構いません。

1. Cloudflare ダッシュボード → **Storage & Databases → Analytics Engine**
2. 右上の **「データセットを作成」** をクリック
3. 名前は **`open_shortlink_clicks`**（`wrangler.toml` と完全一致させる）

これを忘れると deploy が `code: 10089 — You need to enable Analytics Engine`
で失敗します。Cloudflare の仕様で、アカウント上で初めて Analytics Engine
を使う場合のみ必要な初期化作業です（2 回目以降のフォーク先では不要）。
:::

### 入力すべき値

| 項目 | 値 | 備考 |
|---|---|---|
| Worker 名 | `open-shortlink` 等 | 後から変更不可（再デプロイで引継ぎ） |
| `API_TOKEN` | 24 文字以上のランダム値 | `openssl rand -base64 32` の出力を貼付け推奨 |
| `CORS_ALLOW_ORIGIN` | 空欄 | UI を別ドメインに建てる場合のみ |
| `PUBLIC_BASE_URL` | 空欄 | カスタムドメイン設定後に追加 |

### デプロイ後の動作確認

```bash
curl -i https://<your-worker>.workers.dev/api/links
# → 401 unauthorized が返れば成功（正しく認証が効いている）
# → 503 なら API_TOKEN が未入力 / 24 文字未満 / 既知プレースホルダ
```

`503` が返る場合は Cloudflare ダッシュボード → Worker → Settings →
Variables で `API_TOKEN` を上書きしてください。

### 任意・推奨の追加設定

- **カスタムドメイン**: Settings → Triggers → Custom Domains
- **`*.workers.dev` と Preview URL を閉じる**: 初回 deploy のログに次の
  warning が出ます。
  ```
  ▲ workers_dev is not in your Wrangler file → デフォルトで *.workers.dev が有効
  ▲ preview_urls is not in your Wrangler file → Preview URL が有効
  ```
  カスタムドメインを当てたら `wrangler.toml` に以下を追記して再デプロイし、
  攻撃面を減らしてください（apex 占有せず `*.workers.dev` だけで運用する
  場合は `workers_dev = true` のまま）。
  ```toml
  workers_dev = false
  preview_urls = false
  ```
- [Cloudflare Access で API ホストを保護](./security#二線目-cloudflare-access推奨)（組織運用向け）

## 手動セットアップ

### 前提条件

- Bun
- Cloudflare アカウント
- Wrangler CLI（`bun add -g wrangler`）

### 手順

```bash
# 1. リポジトリをクローン
git clone https://github.com/tied-inc/open-shortlink.git
cd open-shortlink

# 2. 依存関係をインストール
bun install

# 3. Cloudflare にログイン
wrangler login

# 4. API_TOKEN を設定（必須）
#    KV 名前空間は次の deploy が自動作成するため事前準備は不要
openssl rand -base64 32 | wrangler secret put API_TOKEN

# 5. デプロイ（KV が自動作成されバインドされる）
bun run deploy
```

## 環境変数

| 変数名 | 説明 | 必須 |
|---|---|---|
| `API_TOKEN` | API / MCP 認証用の Bearer token（24 文字以上） | Yes |
| `CORS_ALLOW_ORIGIN` | CORS allowlist（未設定で全許可） | No |
| `PUBLIC_BASE_URL` | `shortUrl` に使う正本オリジン | No |
| `CF_ACCOUNT_ID` / `CF_ANALYTICS_TOKEN` | 分析 API を使う場合のみ | No |

## Cloudflare リソース

1 クリックデプロイ時に以下のリソースが **自動で作成されバインド** されます。
手動で ID を設定する必要はありません。

- **KV Namespace** (`SHORTLINKS`) — slug → URL のマッピング保存。
  Wrangler 4.45+ が `[[kv_namespaces]]` に `id` が無いことを検知して
  `open-shortlink-shortlinks` のような名前で新規作成する
- **Analytics Engine** (`ANALYTICS`) — クリックデータの記録。
  **dataset は事前作成が必要**（上記「事前準備」を参照）。Cloudflare の
  仕様で、アカウントで Analytics Engine を初めて使う場合は最初の dataset
  だけ手動で作る必要があり、それ以降は同名 dataset にアプリが書き込む

## ローカル開発

```bash
# 開発サーバー起動（KV と Analytics Engine のローカルエミュレーション付き）
bun run dev

# テスト実行
bun test
```

`wrangler dev` がローカルで KV と Analytics Engine をエミュレートするため、Cloudflare アカウントなしでも開発可能。

## MCP サーバーの接続

デプロイ完了後、Claude Desktop 等の MCP クライアントに以下を設定:

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
