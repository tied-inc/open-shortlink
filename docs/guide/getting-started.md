# クイックスタート

::: warning はじめに: 認証プロバイダ（IdP）の設定が必須です
Open Shortlink は、ユーザー認証を外部 IdP に委任します。**Cloudflare Access**
か **任意の OpenID Connect プロバイダ**（Auth0 / Okta / Entra ID /
Google Workspace / Keycloak など）のどちらかを必ず構成してください。
未設定のままでは `/authorize` が **503** を返し、MCP クライアントは
サインインできません（fail-closed 設計）。詳しくは
[セキュリティポリシー](./security) を参照。
:::

## Deploy to Cloudflare（1 クリック）

ボタンを押すと、セットアップ画面で IdP 用のシークレットと Worker 名の
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

### 入力すべき値（OIDC 構成の場合）

汎用 OIDC プロバイダ（Auth0 / Okta / Google / Entra ID / Keycloak / Authelia 等）
を使う場合、上流 IdP で新しい OAuth アプリケーションを登録し、
その **`redirect_uri`** を `https://<your-worker>.workers.dev/oauth/callback`
に設定してから下の値を入力します。

| 項目 | 値 | 備考 |
|---|---|---|
| Worker 名 | `open-shortlink` 等 | 後から変更不可（再デプロイで引継ぎ） |
| `OIDC_ISSUER` | 例: `https://accounts.google.com` | 上流 IdP の issuer URL |
| `OIDC_CLIENT_ID` | 上流で発行された client_id | — |
| `OIDC_CLIENT_SECRET` | 上流で発行された client_secret | Secret として保管 |
| `OIDC_ALLOWED_SUBS` | `you@example.com` | サインインを許可する email / sub のカンマ区切り |
| `OIDC_SCOPES` | 空欄（既定: `openid email profile`） | 必要なら追加 |
| `CORS_ALLOW_ORIGIN` | 空欄 | UI を別ドメインに建てる場合のみ |
| `PUBLIC_BASE_URL` | 空欄 | カスタムドメイン設定後に追加 |

### 入力すべき値（Cloudflare Access の場合）

Worker を Access アプリケーションの背後に置く場合は OIDC の値は不要で、
代わりに次を設定します。Access がユーザー認証を担当し、`/authorize`
リクエストに載せる `Cf-Access-Jwt-Assertion` を Worker が検証します。

| 項目 | 値 | 備考 |
|---|---|---|
| `CF_ACCESS_TEAM_DOMAIN` | `acme.cloudflareaccess.com` | Access のチームドメイン |
| `CF_ACCESS_AUD` | Access アプリの AUD タグ | Zero Trust ダッシュボードで確認 |
| `ACCESS_ALLOWED_EMAILS` | `you@example.com,teammate@example.com` | サインイン許可リスト |

### デプロイ後の動作確認

```bash
# OAuth discovery が返れば OAuth レイヤーは動作中
curl -s https://<your-worker>.workers.dev/.well-known/oauth-authorization-server | jq .

# 認証付きエンドポイントはトークンなしだと 401 になる
curl -i https://<your-worker>.workers.dev/api/links
# → 401 unauthorized が返れば成功（OAuth が正しく掛かっている）

# /authorize は IdP 未設定だと 503、設定済みなら OIDC モードでは上流にリダイレクトする
curl -i "https://<your-worker>.workers.dev/authorize?response_type=code&client_id=test&redirect_uri=https://example"
# → 503 なら IdP 設定が抜けている（Workers → Settings → Variables を確認）
# → 302 Location: https://<idp>/... なら OIDC モードが動作中
```

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

# 4. IdP を 1 つ設定（以下のどちらか）
#    --- OIDC モードの場合 ---
wrangler secret put OIDC_ISSUER          # 例: https://accounts.google.com
wrangler secret put OIDC_CLIENT_ID
wrangler secret put OIDC_CLIENT_SECRET
wrangler secret put OIDC_ALLOWED_SUBS    # 例: you@example.com
#    --- Cloudflare Access モードの場合 ---
# wrangler secret put CF_ACCESS_TEAM_DOMAIN
# wrangler secret put CF_ACCESS_AUD
# wrangler secret put ACCESS_ALLOWED_EMAILS

# 5. デプロイ（KV / OAUTH_KV が自動作成されバインドされる）
bun run deploy
```

## 環境変数

| 変数名 | 説明 | 必須 |
|---|---|---|
| `OIDC_ISSUER` | 上流 OIDC プロバイダの issuer URL | Access を使わないなら Yes |
| `OIDC_CLIENT_ID` | 上流で発行された client_id | 同上 |
| `OIDC_CLIENT_SECRET` | 上流の client_secret（Secret として保存） | 同上 |
| `OIDC_ALLOWED_SUBS` | サインインを許可する email / sub のカンマ区切り | 同上 |
| `OIDC_SCOPES` | 上流に要求するスコープ（既定: `openid email profile`） | No |
| `CF_ACCESS_TEAM_DOMAIN` | `<team>.cloudflareaccess.com` | Access を使うなら Yes |
| `CF_ACCESS_AUD` | Access アプリの AUD タグ | 同上 |
| `ACCESS_ALLOWED_EMAILS` | 許可 email のカンマ区切り | 同上 |
| `CORS_ALLOW_ORIGIN` | CORS allowlist（未設定で全許可） | No |
| `PUBLIC_BASE_URL` | `shortUrl` に使う正本オリジン | No |
| `CF_ACCOUNT_ID` / `CF_ANALYTICS_TOKEN` | 分析 API を使う場合のみ | No |

## Cloudflare リソース

1 クリックデプロイ時に以下のリソースが **自動で作成されバインド** されます。
手動で ID を設定する必要はありません。

- **KV Namespace** (`SHORTLINKS`) — slug → URL のマッピング保存。
  Wrangler 4.45+ が `[[kv_namespaces]]` に `id` が無いことを検知して
  `open-shortlink-shortlinks` のような名前で新規作成する
- **KV Namespace** (`OAUTH_KV`) — OAuth トークン・クライアント登録、
  OIDC discovery キャッシュ、上流認可の state 保存。自動作成される
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

デプロイ完了後、Claude Desktop 等の MCP クライアントに接続する。
詳細は [MCP サーバー](../mcp) のクライアント設定セクションを参照。

### Claude Desktop

1. Claude Desktop → **設定** → **カスタムコネクタを追加**
2. **名前**: `Open Shortlink`、**リモート MCP サーバー URL**: `https://<your-worker>.workers.dev/mcp`
3. OAuth フィールドは空欄のまま **追加** をクリック
4. ブラウザで `/authorize` が開き、設定した IdP（Google / Okta / Auth0 /
   Access 等）のサインイン画面にリダイレクトされます。`OIDC_ALLOWED_SUBS`
   もしくは `ACCESS_ALLOWED_EMAILS` に含まれるアカウントで認証すると、
   自動的に Claude Desktop に戻り接続が完了します。

詳しくは [MCP サーバー → Claude Desktop](../mcp#claude-desktop) を参照。
