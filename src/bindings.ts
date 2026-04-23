export interface Bindings {
  SHORTLINKS: KVNamespace;
  ANALYTICS: AnalyticsEngineDataset;
  API_TOKEN: string;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  // Canonical origin used when building `shortUrl` in API responses and when
  // purging the edge cache. Example: "https://go.example.com".
  PUBLIC_BASE_URL?: string;
  // Optional host split: when set, redirect paths are only served on
  // REDIRECT_HOST and API / MCP paths are only served on API_HOST.
  REDIRECT_HOST?: string;
  API_HOST?: string;
}
