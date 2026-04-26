# デプロイ

::: danger 必読: IdP を設定するまで API は起動しません
Open Shortlink は fail-closed です。IdP（Cloudflare Access か OIDC）が
未設定、または allowlist が空の場合、`/authorize` は **503** を返し、
MCP クライアントはアクセストークンを取得できません。認証付き
エンドポイント（`/api/*`, `/mcp`）もトークンが無いので **401** になります
（誰でも見える状態にはなりません）。デプロイ直後に必ず
[セキュリティポリシー](./security) を一読し、IdP を 1 つだけ設定してください。
:::

## Deploy to Cloudflare（推奨・1 クリック）

ボタンを押すと Cloudflare のセットアップ画面に遷移し、以下が**その場で一度に**完了します。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tied-inc/open-shortlink)

::: warning 事前準備（初回のみ・30 秒）
**Analytics Engine データセットを 1 つ手動で作成しておいてください。**

1. Cloudflare ダッシュボード → **Storage & Databases → Analytics Engine**
2. 右上の **「データセットを作成」** をクリック
3. 名前は **`open_shortlink_clicks`**（`wrangler.toml` の `dataset` と
   完全一致させる）

これを忘れると deploy が `code: 10089 — You need to enable Analytics Engine`
で失敗します。Cloudflare の仕様で、アカウント上で初めて Analytics Engine
を使う場合のみ必要な初期化作業です（同一アカウントでの 2 回目以降の
デプロイ・他リポジトリへのフォークでは不要）。
:::

### セットアップ画面で聞かれること

1. **GitHub への fork 先** — 自分のアカウント / org を選択
2. **Worker 名** — デフォルトは `open-shortlink`。好きに変更可
3. **環境変数 / シークレット** — Cloudflare Access か OIDC のどちらか一方を
   必ず設定する。両方設定すると `/authorize` は 503 になる
   - **OIDC モード**（任意の IdP）:
     - `OIDC_ISSUER`（例: `https://accounts.google.com`）
     - `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`（上流で発行）
     - `OIDC_ALLOWED_SUBS`（サインイン許可する email / sub）
   - **Cloudflare Access モード**:
     - `CF_ACCESS_TEAM_DOMAIN`（`<team>.cloudflareaccess.com`）
     - `CF_ACCESS_AUD`（Access アプリの AUD タグ）
     - `ACCESS_ALLOWED_EMAILS`
   - `CORS_ALLOW_ORIGIN`（任意）— UI を別ドメインに建てるなら入れる
   - `PUBLIC_BASE_URL`（任意）— カスタムドメインに紐付けたあとで設定
4. **KV** — 表示されるが Wrangler が自動プロビジョニングする。手動で
   ID を設定する必要なし（`SHORTLINKS` と `OAUTH_KV` の 2 つが作られる）
5. **Analytics Engine** — dataset は上の事前準備で作成済みのものを使う

Deploy ボタンを押すと Cloudflare 側で fork → KV 作成 → Worker デプロイ → Secret
登録 まで一貫して実行されます。

### OIDC モード: 上流 IdP 側の事前登録

OIDC を使う場合、先に上流 IdP（Google / Auth0 / Okta / Entra ID / Keycloak 等）で
OAuth アプリケーションを登録してください。

- **アプリケーションタイプ**: Confidential / Web
- **Redirect URI**: `https://<your-worker>.workers.dev/oauth/callback`
  （カスタムドメインを当てるなら `https://api.example.com/oauth/callback`）
- **付与するグラント**: Authorization Code + PKCE
- **スコープ**: 最低限 `openid email`（既定は `openid email profile`）

発行された `client_id` と `client_secret` を Worker の Secret として登録します。

### デプロイ直後の動作確認

```bash
# OAuth discovery が返れば OAuth レイヤーは動作中
curl -s https://<your-worker>.workers.dev/.well-known/oauth-authorization-server | jq .

# 401 unauthorized が返れば OK。OAuth による保護が効いている
curl -i https://<your-worker>.workers.dev/api/links

# /authorize の挙動で IdP 設定の健全性が分かる
curl -i "https://<your-worker>.workers.dev/authorize?response_type=code&client_id=test&redirect_uri=https://example"
# → 503 なら IdP 未設定 / allowlist 空 / 両モード同時設定
# → 302 なら OIDC モードが動作中（Location: 上流 IdP の authorize URL）
# → 400/401 なら Access モードで JWT 不備（Access 未経由時は 401）
```

もし **503** が返る場合は、IdP 用の変数がどれか欠けています。レスポンス
ボディの `description` フィールドに具体的な不足項目が書かれているので、
Workers & Pages → 対象の Worker → **Settings → Variables** で
必要な Secret を追加してください。

### 以降の更新

- fork された GitHub リポジトリへの `main` push は Cloudflare 側の Workers Builds
  が検知して自動再デプロイします
- KV 名前空間はそのまま再利用され、データは保持されます

### 任意・推奨の追加設定

- **カスタムドメイン**: Settings → Triggers → Custom Domains。
  [リダイレクトホストと API ホストを分ける](#推奨-リダイレクトホストと-api-ホストを分ける) を検討。
  カスタムドメインに切り替えたら、上流 IdP の Redirect URI を新ドメインの
  `/oauth/callback` に合わせて更新すること
- **`*.workers.dev` と Preview URL を閉じる**: 初回 deploy 時に次の
  warning が出ます。
  ```
  ▲ workers_dev is not in your Wrangler file → デフォルトで *.workers.dev が有効
  ▲ preview_urls is not in your Wrangler file → Preview URL が有効
  ```
  カスタムドメインを当てたあとは、`*.workers.dev` から API/MCP に到達
  されないよう `wrangler.toml` に以下を追記してコミット → 再デプロイで
  攻撃面を縮小できます（`*.workers.dev` を本番 URL として使う場合は
  `workers_dev = true` のまま）。
  ```toml
  workers_dev = false
  preview_urls = false
  ```

## 手動デプロイ

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

# 4. IdP を 1 つ設定（OIDC か Access のどちらか・両方は不可）
#    --- OIDC の場合 ---
wrangler secret put OIDC_ISSUER
wrangler secret put OIDC_CLIENT_ID
wrangler secret put OIDC_CLIENT_SECRET
wrangler secret put OIDC_ALLOWED_SUBS
#    --- Cloudflare Access の場合 ---
# wrangler secret put CF_ACCESS_TEAM_DOMAIN
# wrangler secret put CF_ACCESS_AUD
# wrangler secret put ACCESS_ALLOWED_EMAILS

# 5. デプロイ（初回: SHORTLINKS と OAUTH_KV が自動作成されバインドされる）
bun run deploy

# 6. 動作確認
curl -i https://<your-worker>.workers.dev/api/links
# → 401 unauthorized が返れば OK（OAuth による保護が効いている）
```

上流 IdP の client secret はパスワードマネージャー（1Password / Bitwarden 等）
に保管し、ローテーションは IdP 側の UI から行ったうえで
`wrangler secret put OIDC_CLIENT_SECRET` で上書きしてください。詳細は
[セキュリティポリシー](./security) を参照。

> Wrangler 4.45 以降は `[[kv_namespaces]]` に `id` が無いと初回デプロイで
> 自動作成 → バインドまで行われます（`open-shortlink-SHORTLINKS` のような
> 名前で作成）。2 回目以降は同じ名前空間が再利用され、データも保持され
> ます。旧来の `wrangler kv namespace create` は不要です。

### wrangler.toml の設定

リポジトリ同梱の `wrangler.toml` をそのまま使います。KV 名前空間 ID を
手で書き込む必要はありません。

```toml
name = "open-shortlink"
main = "src/index.ts"
compatibility_date = "2026-04-01"

[observability]
enabled = true

# `id` を書かないことで Wrangler が初回デプロイ時に自動作成する
[[kv_namespaces]]
binding = "SHORTLINKS"

[[analytics_engine_datasets]]
binding = "ANALYTICS"
dataset = "open_shortlink_clicks"
```

`OIDC_CLIENT_SECRET` などの秘密情報は `[vars]` に書かず、
`wrangler secret put` または Cloudflare ダッシュボードの Secret として
登録してください。

## カスタムドメイン

### 基本設定

Cloudflare ダッシュボードから設定:

1. Workers & Pages → 対象の Worker を選択
2. Settings → Triggers → Custom Domains
3. ドメインを追加（例: `go.example.com`）

ドメインの DNS が Cloudflare で管理されている必要がある。Universal SSL の証明書が発行されるまで数分〜数十分かかり、その間は 525/526 が返る。

### 推奨: リダイレクトホストと API ホストを分ける

短縮リンク用とリンク管理 API 用を別サブドメインにすると、誤って API が短縮リンクのホストに露出する事故を防げる。`wrangler.toml`:

```toml
routes = [
  { pattern = "go.example.com/*",  zone_name = "example.com" },
  { pattern = "api.example.com/*", zone_name = "example.com" },
]

[vars]
PUBLIC_BASE_URL = "https://go.example.com"
REDIRECT_HOST   = "go.example.com"
API_HOST        = "api.example.com"
```

- `PUBLIC_BASE_URL`: API レスポンスの `shortUrl` と、DELETE 時のエッジキャッシュ purge に使う正本オリジン
- `REDIRECT_HOST` / `API_HOST`: 両方が設定されると、各ホストが対応するサーフェス以外の経路で 404 を返す

片方だけ使う構成（apex を占有せず `go.example.com` で全部動かす）の場合は、`PUBLIC_BASE_URL` だけ設定して `REDIRECT_HOST` / `API_HOST` は省略してよい。

### 予約パス

以下のパスは短縮リンクより優先され、`/:slug` には到達しない:

- `/` — サービス情報を返す JSON
- `/health` — ヘルスチェック
- `/robots.txt` — クローラーへの `Disallow`
- `/favicon.ico` — 204 No Content
- `/api/*`, `/mcp/*` — API / MCP（OAuth 認証必須）
- `/authorize`, `/token`, `/register`, `/oauth/callback` — OAuth エンドポイント
- `/.well-known/oauth-authorization-server`,
  `/.well-known/oauth-protected-resource` — OAuth メタデータ

slug として `api`, `mcp`, `health`, `robots`, `favicon`, `sitemap`, `well-known`,
`authorize`, `token`, `register`, `oauth` を登録しようとすると 400 になる。

## レート制限

Open Shortlink は二段構えでレート制限を行う。

### 1. Worker 組込み（per-isolate）

`src/middleware/rate-limit.ts` の in-memory 実装が `/api/*` と `/mcp`, `/mcp/*` に
対して IP 単位で動く（既定: 60 秒あたり 120 リクエスト）。

- 状態は Worker の isolate ごとに保持される。Cloudflare は世界中の複数 isolate
  で並列にリクエストを処理するため、**グローバルなリミットにはならない**。
- 目的は「1 isolate に対するバーストや雑なリトライを弾く」スパイク防止の
  セーフティネット。
- 超過時は `429 Too Many Requests` と `Retry-After` / `X-RateLimit-*` ヘッダを
  返す。

### 2. Cloudflare Rate Limiting Rules（推奨・グローバル）

シングルテナント運用ではダッシュボードの Rate Limiting Rules による enforcement
を推奨する。エッジでグローバルに効き、Worker 実装を増やさずに済む。

設定手順:

1. Cloudflare ダッシュボード → 対象ゾーン → **Security → WAF → Rate limiting rules**
2. "Create rule" を選択
3. **Match**: 例として `/api/` と `/mcp` を対象にする
   - Field: `URI Path`
   - Operator: `starts with`
   - Value: `/api/` または `/mcp`
4. **Rate**: 例 `120 requests per 1 minute`、Characteristics は `IP`
5. **Action**: `Block`（または `Managed Challenge`）
6. 保存

> Rate Limiting Rules は有料プランを含む一部プランで利用可能。無料プランで
> 運用する場合は Worker 組込みのリミッタのみで運用し、必要に応じて
> カスタムドメインを Cloudflare プロキシ配下に置いて WAF 機能を活用する。

### チューニング

デフォルト値は `src/index.ts` で設定している。トラフィック特性に合わせて
`windowMs` / `max` を調整する。リダイレクト (`GET /:slug`) には意図的に
レートリミットを掛けていない（ホットパスであり、IP/地域偏りの大きい正規
トラフィックを弾きたくない）。こちらも必要なら Rate Limiting Rules 側で
吸収する。

## CI/CD

このリポジトリでは GitHub Actions から `wrangler deploy` を実行していない。継続的デプロイは **Cloudflare コンソール側の Workers Builds** で完結させる想定。

### Workers Builds の挙動

Deploy to Cloudflare ボタンでセットアップした場合、Cloudflare 側で以下が自動設定される:

- fork 先の GitHub リポジトリが Worker プロジェクトに接続される
- ビルドコマンド: `bun install && bun run deploy`
- 監視ブランチ: `main`
- `main` への push を検知すると、Cloudflare 側でビルド → デプロイが走る

ビルドログ・デプロイ状況は Cloudflare ダッシュボードの **Workers & Pages → 対象 Worker → Deployments / Builds** タブから確認できる。

### コンソール上からの手動再デプロイ

失敗したデプロイを再実行したい場合や、特定のコミットを再度デプロイしたい場合は、**Deployments** タブから該当ビルドの「Retry deployment」を選択するだけでよい。ローカルや GitHub Actions からのコマンド実行は不要。

### GitHub Actions を使いたい場合

原則コンソールでの運用を推奨するが、どうしても GitHub Actions を使いたい場合は、Cloudflare 側の Workers Builds を無効にした上で、自前のワークフローに以下を組み込む:

```yaml
- uses: oven-sh/setup-bun@v2
- run: bun install
- run: bun run deploy
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
```

Cloudflare 側と GitHub Actions 側の両方から同時に `wrangler deploy` が走ると競合するため、いずれか一方に寄せること。
