export interface Bindings {
  SHORTLINKS: KVNamespace;
  ANALYTICS: AnalyticsEngineDataset;
  API_TOKEN: string;
  CF_ACCOUNT_ID?: string;
  CF_ANALYTICS_TOKEN?: string;
  // Comma-separated origin allowlist for CORS. Unset => permissive (reflects
  // request Origin or `*`). Set to `*` to explicitly remain permissive.
  CORS_ALLOW_ORIGIN?: string;
}
