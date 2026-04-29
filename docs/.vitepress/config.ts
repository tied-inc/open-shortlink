import { defineConfig } from "vitepress";

export default defineConfig({
  title: "Open Shortlink",
  description: "オープンソースの URL 短縮サービス — Cloudflare Workers で動作",
  cleanUrls: true,
  base: "/open-shortlink/",

  locales: {
    root: {
      label: "日本語",
      lang: "ja",
      themeConfig: {
        nav: [
          { text: "ガイド", link: "/guide/getting-started" },
          { text: "API", link: "/api" },
          { text: "リリース", link: "/releases" },
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
              { text: "セキュリティ", link: "/guide/security" },
            ],
          },
          {
            text: "リファレンス",
            items: [
              { text: "REST API", link: "/api" },
              { text: "MCP サーバー", link: "/mcp" },
            ],
          },
          {
            text: "リリース",
            items: [{ text: "リリースノート", link: "/releases" }],
          },
        ],
      },
    },
    en: {
      label: "English",
      lang: "en",
      link: "/en/",
      description: "Open source URL shortener — runs on Cloudflare Workers",
      themeConfig: {
        nav: [
          { text: "Guide", link: "/en/guide/getting-started" },
          { text: "API", link: "/en/api" },
          { text: "Releases", link: "/en/releases" },
          { text: "GitHub", link: "https://github.com/tied-inc/open-shortlink" },
        ],

        sidebar: [
          {
            text: "Introduction",
            items: [
              { text: "What is Open Shortlink?", link: "/en/guide/introduction" },
              { text: "Quick Start", link: "/en/guide/getting-started" },
              { text: "Deploy", link: "/en/guide/deploy" },
            ],
          },
          {
            text: "Design",
            items: [
              { text: "Architecture", link: "/en/guide/architecture" },
              { text: "Click Analytics", link: "/en/guide/analytics" },
              { text: "Security", link: "/en/guide/security" },
            ],
          },
          {
            text: "Reference",
            items: [
              { text: "REST API", link: "/en/api" },
              { text: "MCP Server", link: "/en/mcp" },
            ],
          },
          {
            text: "Releases",
            items: [{ text: "Release Notes", link: "/en/releases" }],
          },
        ],
      },
    },
  },

  themeConfig: {
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
