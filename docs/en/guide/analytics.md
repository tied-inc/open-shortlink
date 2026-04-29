# Click Analytics

## Overview

Open Shortlink uses Cloudflare Analytics Engine to record click data. Because Analytics Engine writes asynchronously, redirect response speed is unaffected.

## Recorded data

When a redirect occurs, the following data is recorded asynchronously via `waitUntil()`:

| Field | Analytics Engine column | Content | Source |
|---|---|---|---|
| slug | blob1 | Short URL slug | Request path |
| Referrer | blob2 | Referring URL | `Referer` header |
| Country code | blob3 | Visitor's country | `request.cf.country` |
| User-Agent | blob4 | Browser / bot info | `User-Agent` header |
| AI flag | blob5 | `"ai"` or `"human"` | User-Agent detection |
| Timestamp | double1 | Click time (Unix ms) | `Date.now()` |

## AI access detection

If the User-Agent string contains any of the following, the access is classified as AI:

| Bot name | User-Agent pattern | Operator |
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

This list is managed in `src/analytics/ai-detector.ts`. To support a new AI bot, just update that file.

## Query examples

Analytics Engine can be queried via the SQL API. To access it through API endpoints, use the [REST API](/en/api) or [MCP tools](/en/mcp).

### Total clicks for a specific slug

```sql
SELECT COUNT() as clicks
FROM analytics
WHERE blob1 = 'abc123'
  AND timestamp > NOW() - INTERVAL '7' DAY
```

### Clicks by country

```sql
SELECT blob3 as country, COUNT() as clicks
FROM analytics
WHERE blob1 = 'abc123'
GROUP BY country
ORDER BY clicks DESC
LIMIT 10
```

### AI vs Human ratio

```sql
SELECT blob5 as type, COUNT() as clicks
FROM analytics
WHERE timestamp > NOW() - INTERVAL '30' DAY
GROUP BY type
```

### Access count by AI bot

```sql
SELECT blob4 as user_agent, COUNT() as clicks
FROM analytics
WHERE blob5 = 'ai'
  AND timestamp > NOW() - INTERVAL '30' DAY
GROUP BY user_agent
ORDER BY clicks DESC
```

## Free tier

Analytics Engine free tier:

- Writes: **100k data points/day**
- Reads: **10k queries/day**

Up to 100k clicks per day can be analyzed for free.
