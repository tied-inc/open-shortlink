# Open Shortlink とは

Open Shortlink は、Cloudflare Workers 上で動作するオープンソースの URL 短縮サービスです。

short.io や bit.ly のような URL 短縮サービスを、自分の Cloudflare アカウントでホスティングできます。Cloudflare の無料枠の範囲で運用できるため、小〜中規模であれば月額 $0 で利用可能です。

![Open Shortlink サービス構成図](/overview.svg)

エンドユーザーからの短縮 URL アクセスは Cloudflare Workers 上の Redirect ハンドラが受け、KV でオリジナル URL を引いて 302 を返します。クリックは `waitUntil()` で Analytics Engine に非同期書込みされ、リダイレクトのレイテンシには影響しません。リンク管理や分析は REST API または MCP Server 経由で行い、Claude などの AI アシスタントから自然言語でそのまま操作できます。

## 特徴

- **低コスト運用** — Cloudflare Workers + KV の無料枠で月額 $0 運用が可能
- **高速リダイレクト** — KV のエッジ読み取りによる低レイテンシ
- **クリック分析** — Analytics Engine による非同期トラッキング（リファラー、国、時系列、AI アクセス判定）
- **AI ネイティブ管理** — Web UI の代わりに Remote MCP サーバーを提供。AI アシスタントから直接リンク管理・分析閲覧
- **ワンクリックデプロイ** — Deploy to Cloudflare ボタンで即座にセットアップ

## 運用モデル

シングルテナント前提の設計です。必要な人が自分の Cloudflare アカウントにデプロイして使います。マルチテナントやユーザー管理の機能はありません。

## 無料枠

| リソース | 無料枠 | 用途 |
|---|---|---|
| Workers | 10 万リクエスト/日 | リダイレクト + API |
| KV 読取り | 10 万/日 | リダイレクト時の slug 検索 |
| KV 書込み | 1,000/日 | 短縮 URL 作成 |
| Analytics Engine 書込み | 10 万データポイント/日 | クリック記録 |
| Analytics Engine 読取り | 1 万クエリ/日 | 分析 |

## 管理インターフェース

Web UI は提供しません。代わりに以下の方法で管理します:

- **REST API** — curl や HTTP クライアントから操作
- **MCP サーバー** — Claude Desktop 等の AI アシスタントから操作

```
「https://example.com/long-page を短縮して」
「先週のクリック数トップ10を見せて」
「AI からのアクセス割合はどれくらい？」
```
