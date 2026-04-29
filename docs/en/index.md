---
layout: home

hero:
  name: Open Shortlink
  text: Open source URL shortener
  tagline: Runs on Cloudflare Workers. Operable on the free tier. AI-native management.
  actions:
    - theme: brand
      text: Get Started
      link: /en/guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/tied-inc/open-shortlink

features:
  - title: Low-cost operation
    details: Run on the Cloudflare Workers + KV free tier for $0/month
  - title: Fast redirects
    details: Low latency via KV edge reads. A redirect completes in a single KV.get()
  - title: Click analytics
    details: Asynchronous tracking via Analytics Engine. Referrer, country, time series, AI access detection
  - title: AI-native management
    details: Manage links and view analytics directly from AI assistants via the Remote MCP server
  - title: One-click deploy
    details: The Deploy to Cloudflare button automates everything from fork to deploy
  - title: Simple architecture
    details: A single Worker integrates redirect, API, and MCP server
---
