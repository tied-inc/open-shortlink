# クリック分析

## 概要

Open Shortlink は Cloudflare Analytics Engine を使ってクリックデータを記録する。Analytics Engine は非同期書込みのため、リダイレクトのレスポンス速度に影響を与えない。

## 記録するデータ

リダイレクト発生時に以下のデータを `waitUntil()` で非同期記録:

| フィールド | Analytics Engine カラム | 内容 | 取得元 |
|---|---|---|---|
| slug | blob1 | 短縮 URL の slug | リクエストパス |
| リファラー | blob2 | 参照元 URL | `Referer` ヘッダー |
| 国コード | blob3 | アクセス元の国 | `request.cf.country` |
| User-Agent | blob4 | ブラウザ / ボット情報 | `User-Agent` ヘッダー |
| AI フラグ | blob5 | `"ai"` または `"human"` | User-Agent 判定 |
| タイムスタンプ | double1 | クリック時刻（Unix ms） | `Date.now()` |

## AI アクセス判定

User-Agent 文字列に以下のいずれかが含まれる場合、AI アクセスと判定する:

| ボット名 | User-Agent パターン | 運営元 |
|---|---|---|
| GPTBot | `GPTBot` | OpenAI |
| ChatGPT-User | `ChatGPT-User` | OpenAI |
| ClaudeBot | `ClaudeBot` | Anthropic |
| Claude-Web | `Claude-Web` | Anthropic |
| PerplexityBot | `PerplexityBot` | Perplexity |
| Bytespider | `Bytespider` | ByteDance |
| Applebot-Extended | `Applebot-Extended` | Apple |
| Google-Extended | `Google-Extended` | Google |
| CCBot | `CCBot` | Common Crawl |
| anthropic-ai | `anthropic-ai` | Anthropic |
| cohere-ai | `cohere-ai` | Cohere |
| meta-externalagent | `meta-externalagent` | Meta |

このリストは `src/analytics/ai-detector.ts` で管理され、新しい AI ボットの追加は同ファイルを更新するだけで対応可能。

## クエリ例

Analytics Engine は SQL API でクエリできる。API エンドポイント経由でアクセスする場合は [REST API](/api) または [MCP ツール](/mcp) を使用する。

### 特定 slug の総クリック数

```sql
SELECT COUNT() as clicks
FROM analytics
WHERE blob1 = 'abc123'
  AND timestamp > NOW() - INTERVAL '7' DAY
```

### 国別クリック数

```sql
SELECT blob3 as country, COUNT() as clicks
FROM analytics
WHERE blob1 = 'abc123'
GROUP BY country
ORDER BY clicks DESC
LIMIT 10
```

### AI vs Human の比率

```sql
SELECT blob5 as type, COUNT() as clicks
FROM analytics
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY type
```

### AI ボット別アクセス数

```sql
SELECT blob4 as user_agent, COUNT() as clicks
FROM analytics
WHERE blob5 = 'ai'
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY user_agent
ORDER BY clicks DESC
```

## 無料枠

Analytics Engine の無料枠:

- 書込み: **10 万データポイント/日**
- 読取り: **1 万クエリ/日**

日間 10 万クリックまでは無料で分析可能。
