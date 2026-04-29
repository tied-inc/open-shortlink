---
name: shortlink
description: Open Shortlink の MCP ツールで短縮 URL を作成・管理し、クリック統計や AI アクセス比率を分析するためのガイド。ユーザーが URL を短縮したい、短縮済みリンクの一覧・詳細・削除を求めた、クリック分析やトップリンク、AI ボット経由のアクセス比率を知りたいと言ったときに使う。
---

# Open Shortlink スキル

Open Shortlink は Cloudflare Workers 上で動く URL 短縮サービスで、Remote MCP サーバーを内蔵している。このスキルは `shortlink` MCP サーバーが提供する 8 つのツールを正しく使い分けるための指針をまとめたもの。

## 前提

- 接続先: `${SHORTLINK_MCP_URL}`（例: `https://your-shortlink.workers.dev/mcp`）
- 認証: **OAuth 2.1**。初回接続時にブラウザで `/authorize` が開き、Worker 側で構成された IdP（Cloudflare Access か任意の OpenID Connect プロバイダ）でサインインする。Claude Code / Claude Desktop の MCP クライアントがアクセストークンを自動取得・更新するため、クライアント側で静的トークンを保持する必要はない。
- MCP 接続情報は `.claude-plugin/plugin.json` の `mcpServers.shortlink` に定義済み。環境変数 `SHORTLINK_MCP_URL` を設定すれば有効化される。

## ツールの使い分け

| やりたいこと | 使うツール |
|---|---|
| 新しい短縮 URL を発行 | `create_link` |
| 既存リンクを一覧表示（ページング可） | `list_links` |
| 特定 slug の詳細を確認 | `get_link` |
| リンクを削除 | `delete_link` |
| 特定 slug のクリック統計（国/リファラー/AI 比） | `get_analytics` |
| 特定 slug のクリック時系列 | `get_timeseries` |
| 期間内のクリック数ランキング | `get_top_links` |
| サイト全体の AI ボット比率とボット別内訳 | `get_ai_stats` |

## `create_link` の作法

- `url` は必須。`https://` または `http://` から始まる絶対 URL を渡す。相対パスや裸のドメインは 400 になる。
- `slug` を省略すると 6 文字の base62 slug が自動生成される（約 568 億通り）。衝突を気にする必要はほぼない。
- カスタム `slug` を指定する場合:
  - 使える文字は英数字・ハイフン (`-`)・アンダースコア (`_`) のみ
  - `api` または `mcp` で始まる slug は**禁止**（Worker のルーティング衝突防止）
  - 既に存在する slug を指定すると 409 `LinkConflictError`。別の slug に変えて再試行する
- `expiresIn` は秒単位。省略時は無期限。KV の `expirationTtl` により Cloudflare 側で自動削除される。
  - 1 日 = 86400, 1 週間 = 604800, 30 日 = 2592000
- 生成後はレスポンスの `shortUrl` をユーザーに提示する。`slug` 単体ではなく完全な URL を伝えると親切。

### 期限設定のガイドライン

| 用途 | 推奨 `expiresIn` |
|---|---|
| キャンペーン・告知（イベント日決まっている） | イベント終了までの秒数 |
| 一時共有（チャットで 1 回使うだけ） | 86400（1 日）〜 604800（1 週間） |
| 恒久リンク（ドキュメント、プロフィール） | 省略（無期限） |

期限を付けるかユーザーが明示していないときは**基本的に無期限**で作る。勝手に期限を付けない。

## 分析系ツールの作法

### `period` パラメータ

- 受け付ける値は `"1d" | "7d" | "30d" | "90d"` のみ。他の値は渡さない。
- 省略時のデフォルトは `"7d"`。
- ユーザーが「昨日」「今日」と言ったら `1d`、「先週」「1 週間」なら `7d`、「今月」「直近 1 ヶ月」なら `30d`、「四半期」「3 ヶ月」なら `90d` にマップする。任意日数（例: 14 日）はサポートされていない — 直近の上位の期間（この場合 30d）を使いフィルタ不可と伝える。

### `get_analytics` の読み方

レスポンスには以下が含まれる:

- `totalClicks` / `aiClicks` / `humanClicks`: AI と人間のクリック内訳
- `uniqueCountries`: アクセス元の国数
- `topReferers`: 上位リファラー（`referer` + `clicks`）
- `topCountries`: 上位国コード（`country` + `clicks`）

ユーザーに見せるときは数値を羅列するのではなく、**目立つ変化や偏り**に触れる（例: 「AI 比率が 30% と高め」「JP と US で 70% を占める」）。

### `get_timeseries`

特定 slug のクリック数を時系列で返す。`period`（`1d` / `7d` / `30d` /
`90d`）と `interval`（`1h` または `1d`）を渡す。`1h` は短い `period`
（`1d` または `7d`）と組み合わせる用途を想定 — 長い `period` × `1h` は
レスポンスが巨大になる。

返り値は `data: [{ timestamp, clicks, aiClicks }]`。推移をユーザーに
見せるときは全バケットを読み上げず、**ピークや谷**にフォーカスする。

### `get_top_links`

`limit` のデフォルトは 10。ユーザーが「トップ 5」などと言えば `limit: 5` を渡す。返り値の `links` は slug とクリック数の配列なので、**同時に `get_link` で URL を引いて見せる**と実用的。必要なら並列で呼び出してよい。

### `get_ai_stats`

`aiRatio` は 0〜1 の小数。ユーザーに見せるときは**百分率に直す**（`0.09` → `9%`）。`byBot` は `GPTBot`, `ClaudeBot`, `PerplexityBot` などのボット名と件数。0 件のボットは省略されることがある。

## エラーハンドリング

| エラー | 原因 | 対処 |
|---|---|---|
| `LinkValidationError` | URL または slug の形式が不正 | 入力を見直してユーザーに確認 |
| `LinkConflictError` | slug が既に存在 | 別 slug を提案（自動生成に切り替える等） |
| `LinkNotFoundError` | 指定 slug が存在しない | `list_links` で実在する slug を確認してから再試行 |
| `429 Too Many Requests` | IP あたり 60 秒 120 リクエスト超過 | `Retry-After` ヘッダーに従って待つ。一括処理なら件数を減らす |
| `Analytics query is not configured` | `CF_ACCOUNT_ID` / `CF_ANALYTICS_TOKEN` 未設定 | サーバー側設定の問題。ユーザーに Worker の secret 設定を確認してもらう |

## バッチ処理のヒント

- 複数 URL の一括短縮: `create_link` を並列呼び出しで OK。ただし連続で大量に叩くとレート制限に当たるので、数十件を超える場合は逐次 + 小休止を入れる。
- 一覧の全走査: `list_links` は cursor ページネーション。`cursor` が返ってこなくなるまでループする。
- トップリンクの詳細取得: `get_top_links` → 各 slug に `get_link` を並列実行、が定番。

## やってはいけないこと

- `slug` に `api`, `mcp`, `authorize`, `token`, `register`, `oauth` から始まる文字列を提案しない（ルーティング衝突で常に失敗する）
- `expiresIn` を勝手に付けない — ユーザーが期限を望んでいない限り無期限で作る
- `period` に `"14d"` や `"1m"` など定義外の値を渡さない
- 認証エラー（401）が出たら再試行せず、ユーザーに MCP クライアントの再認可（OAuth 再サインイン）を促す。503 が返る場合は Worker 側の IdP 設定（`CF_ACCESS_*` または `OIDC_*`）が不足しているので、運用者に確認してもらう
