# What is Open Shortlink?

Open Shortlink is an open source URL shortener that runs on Cloudflare Workers.

You can host a URL shortener like short.io or bit.ly in your own Cloudflare account. Because it runs within Cloudflare's free tier, small to mid-scale deployments cost $0/month.

![Open Shortlink service diagram](/overview.svg)

End-user requests to a short URL are received by the Redirect handler on Cloudflare Workers, which looks up the original URL in KV and returns 302. Clicks are written asynchronously to Analytics Engine via `waitUntil()`, so they do not affect redirect latency. Link management and analytics go through the REST API or the MCP Server, which lets AI assistants like Claude operate the service in natural language.

## Features

- **Low-cost operation** — Run on the Cloudflare Workers + KV free tier for $0/month
- **Fast redirects** — Low latency via KV edge reads
- **Click analytics** — Asynchronous tracking via Analytics Engine (referrer, country, time series, AI access detection)
- **AI-native management** — A Remote MCP server is provided instead of a Web UI. Manage links and view analytics directly from AI assistants
- **One-click deploy** — Set up instantly with the Deploy to Cloudflare button

## Operations model

Designed as single-tenant. Each operator deploys it to their own Cloudflare account. There are no multi-tenant or user management features.

## Free tier

| Resource | Free tier | Purpose |
|---|---|---|
| Workers | 100k requests/day | Redirect + API |
| KV reads | 100k/day | slug lookup at redirect time |
| KV writes | 1,000/day | Short URL creation |
| Analytics Engine writes | 100k data points/day | Click recording |
| Analytics Engine reads | 10k queries/day | Analytics |

## Management interface

There is no Web UI. Manage the service through one of the following:

- **REST API** — Operate via curl or any HTTP client
- **MCP server** — Operate via AI assistants like Claude Desktop

```
"Shorten https://example.com/long-page"
"Show me the top 10 most-clicked links from last week"
"What percentage of access is from AI?"
```
