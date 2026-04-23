# Open Shortlink

オープンソースの URL 短縮サービス。Cloudflare Workers 上で動作し、無料枠の範囲で運用可能。

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/tied-inc/open-shortlink)

## 特徴

- **低コスト運用** — Cloudflare Workers + KV の無料枠で月額 $0 運用が可能
- **高速リダイレクト** — KV のエッジ読み取りによる低レイテンシ
- **クリック分析** — Analytics Engine による非同期トラッキング（リファラー、国、時系列、AI アクセス判定）
- **AI ネイティブ管理** — Remote MCP サーバーとして AI アシスタントから直接操作可能
- **ワンクリックデプロイ** — Deploy to Cloudflare ボタンで即座にセットアップ

詳細は [ドキュメント](https://tied-inc.github.io/open-shortlink/) および [SPEC.md](./SPEC.md) を参照。

## 開発

```bash
bun install
bun run dev          # ローカル開発サーバー (wrangler dev)
bun test             # テスト実行
bun run typecheck    # 型チェック
bun run deploy       # Cloudflare にデプロイ
```

### ドキュメントサイト

```bash
bun run docs:dev     # VitePress 開発サーバー
bun run docs:build   # 本番ビルド
```

## ライセンス

MIT
