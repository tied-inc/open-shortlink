# デプロイ

::: danger 必読: API_TOKEN を設定するまで API は起動しません
Open Shortlink は fail-closed です。`API_TOKEN` が未設定または弱い場合、
`/api/*` と `/mcp*` は **503** を返し続けます（誰でも見える状態にはなりません）。
デプロイ直後に必ず [セキュリティポリシー](./security) を一読し、
強いランダム値の `API_TOKEN` を Secret として設定してください。
:::

## Deploy to Cloudflare（推奨）

最も簡単な方法。ボタンをクリックするだけで、Cloudflare のコンソール上でデプロイが完結する。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tied-inc/open-shortlink)

### 自動で行われること

1. GitHub リポジトリを自分のアカウントに fork
2. Cloudflare コンソール上で Workers プロジェクトが作成され、fork したリポジトリが接続される
3. Cloudflare 側のビルド（Workers Builds）で `wrangler deploy` が実行される
4. KV Namespace と Analytics Engine が自動作成

> このリポジトリでは GitHub Actions から `wrangler deploy` を実行しない。ビルドおよびデプロイは Cloudflare コンソール側で完結する想定。以降の `main` への push も、Cloudflare 側の Workers Builds でデプロイされる。

### デプロイ後の必須設定（順序を守ること）

**ステップ 1（必須）: API_TOKEN を設定する。設定しない限り API/MCP は 503 を返し続けます。**

1. Workers & Pages → 対象の Worker → **Settings → Variables**
2. "Add variable" → **Encrypt** にチェック → 名前を `API_TOKEN` に
3. 値は **24 文字以上のランダム値**。例:
   ```bash
   openssl rand -base64 32
   ```
   `dev-token-change-me` / `test-token` / `secret` などは Worker が拒否します
4. 保存後、`curl -i https://<your-worker>/api/links` で `401 unauthorized`
   （503 ではなく）が返ることを確認

**ステップ 2（任意）: カスタムドメインと API ホスト分離**

- **Settings → Triggers → Custom Domains** でドメインを設定
- 運用チームで使う場合は [リダイレクトホストと API ホストを分ける](#推奨-リダイレクトホストと-api-ホストを分ける) を推奨

**ステップ 3（推奨・組織向け）: Cloudflare Access で API ホストを保護**

SSO / 送信元 IP / デバイス姿勢で API へのアクセスを絞りたい場合は
[セキュリティポリシー](./security#二線目-cloudflare-access推奨) を参照。
MCP クライアントは Access Service Token と併用します。

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

# 4. KV Namespace を作成
wrangler kv namespace create SHORTLINKS
# 出力された id を wrangler.toml に設定

# 5. API_TOKEN を設定（必須・24 文字以上のランダム値）
openssl rand -base64 32 | wrangler secret put API_TOKEN

# 6. デプロイ
bun run deploy

# 7. 動作確認: 401 が返れば OK（503 なら API_TOKEN が未設定 / 弱い）
curl -i https://<your-worker>.workers.dev/api/links
```

トークンはパスワードマネージャー（1Password / Bitwarden など）に保管し、
ローテーション方針は [セキュリティポリシー](./security#ローテーション)
を参照。

### wrangler.toml の設定

```toml
name = "open-shortlink"
main = "src/index.ts"
compatibility_date = "2024-12-01"

[vars]
# API_TOKEN は wrangler secret で設定（ここには書かない）

[[kv_namespaces]]
binding = "SHORTLINKS"
id = "<KV Namespace ID>"

[[analytics_engine_datasets]]
binding = "ANALYTICS"
```

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
- `/api/*`, `/mcp/*` — API / MCP

slug として `api`, `mcp`, `health`, `robots`, `favicon`, `sitemap`, `well-known` を登録しようとすると 400 になる。

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
