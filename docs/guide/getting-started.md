# クイックスタート

::: warning はじめに: 認証トークンが必須です
Open Shortlink の API/MCP は `API_TOKEN` （Bearer 認証）を設定しないと
**503** を返し続けます（fail-closed 設計）。デプロイ直後に必ずトークンを
設定してください。詳しくは [セキュリティポリシー](./security) を参照。
:::

## Deploy to Cloudflare（推奨）

最も簡単な方法。ボタンをクリックするだけで、Cloudflare コンソール上でデプロイまで完結します。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tied-inc/open-shortlink)

### 自動で行われること

1. GitHub リポジトリを自分のアカウントに fork
2. Cloudflare コンソール上で Worker プロジェクトが作成され、fork リポジトリが接続される
3. Cloudflare 側（Workers Builds）で `wrangler deploy` が実行される
4. KV Namespace と Analytics Engine が自動作成

> このリポジトリでは GitHub Actions から `wrangler deploy` を実行しません。以降のデプロイもすべて Cloudflare コンソール側で完結します。デプロイ状況は Cloudflare ダッシュボードの **Workers & Pages → 対象 Worker → Deployments** タブから確認できます。

### デプロイ後の設定

1. **必須**: Cloudflare ダッシュボード → Worker → Settings → Variables で
   `API_TOKEN` を **Secret** として追加。値は `openssl rand -base64 32` の
   ような 24 文字以上のランダム値。既知プレースホルダ（`dev-token-change-me`
   など）は Worker が拒否します
2. 動作確認: `curl -i https://<your-worker>/api/links` が **401** を返すこと
   （503 なら `API_TOKEN` が未設定または弱い）
3. （オプション）カスタムドメインを設定
4. （推奨）組織運用なら [Cloudflare Access で API ホストを保護](./security#二線目-cloudflare-access推奨)

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

# 4. KV Namespace を作成
wrangler kv namespace create SHORTLINKS
# 出力された id を wrangler.toml に設定

# 5. API_TOKEN を設定
wrangler secret put API_TOKEN
# プロンプトでトークンを入力

# 6. デプロイ
bun run deploy
```

## 環境変数

| 変数名 | 説明 | 必須 |
|---|---|---|
| `API_TOKEN` | API / MCP 認証用の Bearer token | Yes |

## Cloudflare リソース

デプロイ時に以下のリソースが作成されます:

- **KV Namespace** (`SHORTLINKS`) — slug → URL のマッピング保存
- **Analytics Engine** (`ANALYTICS`) — クリックデータの記録

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
