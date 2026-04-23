import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Open Shortlink",
  description: "オープンソースの URL 短縮サービス — Cloudflare Workers で動作",
  lang: "ja",
  cleanUrls: true,
  base: "/open-shortlink/",

  themeConfig: {
    nav: [
      { text: "ガイド", link: "/guide/getting-started" },
      { text: "API", link: "/api" },
      { text: "GitHub", link: "https://github.com/tied-inc/open-shortlink" },
    ],

    sidebar: [
      {
        text: "はじめに",
        items: [
          { text: "Open Shortlink とは", link: "/guide/introduction" },
          { text: "クイックスタート", link: "/guide/getting-started" },
          { text: "デプロイ", link: "/guide/deploy" },
        ],
      },
      {
        text: "設計",
        items: [
          { text: "アーキテクチャ", link: "/guide/architecture" },
          { text: "クリック分析", link: "/guide/analytics" },
        ],
      },
      {
        text: "リファレンス",
        items: [
          { text: "REST API", link: "/api" },
          { text: "MCP サーバー", link: "/mcp" },
        ],
      },
    ],

    socialLinks: [
      {
        icon: "github",
        link: "https://github.com/tied-inc/open-shortlink",
      },
    ],

    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © tied, inc.",
    },

    search: {
      provider: "local",
    },
  },
});
