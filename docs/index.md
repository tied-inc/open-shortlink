---
layout: home

hero:
  name: Open Shortlink
  text: オープンソースの URL 短縮サービス
  tagline: Cloudflare Workers で動作。無料枠で運用可能。AI ネイティブ管理。
  actions:
    - theme: brand
      text: はじめる
      link: /guide/getting-started
    - theme: alt
      text: GitHub
      link: https://github.com/tied-inc/open-shortlink

features:
  - title: 低コスト運用
    details: Cloudflare Workers + KV の無料枠で月額 $0 運用が可能
  - title: 高速リダイレクト
    details: KV のエッジ読み取りによる低レイテンシ。リダイレクトは KV.get() 1回で完結
  - title: クリック分析
    details: Analytics Engine による非同期トラッキング。リファラー、国、時系列、AI アクセス判定
  - title: AI ネイティブ管理
    details: Remote MCP サーバーとして AI アシスタントから直接リンク管理・分析閲覧
  - title: ワンクリックデプロイ
    details: Deploy to Cloudflare ボタンで fork からデプロイまで自動化
  - title: シンプル構成
    details: 1 つの Worker にリダイレクト・API・MCP サーバーをすべて統合
---
