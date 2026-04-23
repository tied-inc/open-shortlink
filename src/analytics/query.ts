import { detectAiBot } from "./ai-detector";

export type Period = "1d" | "7d" | "30d" | "90d";
export type Interval = "1h" | "1d";

const DATASET = "open_shortlink_clicks";

export interface SlugAnalytics {
  slug: string;
  period: Period;
  totalClicks: number;
  uniqueCountries: number;
  aiClicks: number;
  humanClicks: number;
  topReferers: { referer: string; clicks: number }[];
  topCountries: { country: string; clicks: number }[];
}

export interface TimeseriesPoint {
  timestamp: string;
  clicks: number;
  aiClicks: number;
}

export interface TopLink {
  slug: string;
  clicks: number;
}

export interface AiStats {
  period: Period;
  totalClicks: number;
  aiClicks: number;
  humanClicks: number;
  aiRatio: number;
  byBot: { bot: string; clicks: number }[];
}

export interface AnalyticsCreds {
  accountId: string;
  apiToken: string;
}

export class AnalyticsQuery {
  constructor(private readonly creds: AnalyticsCreds) {}

  async runSql<T = Record<string, unknown>>(sql: string): Promise<T[]> {
    const res = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${this.creds.accountId}/analytics_engine/sql`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.creds.apiToken}`,
          "Content-Type": "text/plain",
        },
        body: sql,
      },
    );

    if (!res.ok) {
      throw new Error(
        `Analytics Engine query failed: ${res.status} ${await res.text()}`,
      );
    }

    const json = (await res.json()) as { data?: T[] };
    return json.data ?? [];
  }

  async getSlugAnalytics(slug: string, period: Period): Promise<SlugAnalytics> {
    const interval = periodToInterval(period);
    const safeSlug = escapeSql(slug);

    const [totals, referers, countries] = await Promise.all([
      this.runSql<{ total: number; ai: number; countries: number }>(
        `SELECT
           COUNT() AS total,
           SUM(IF(blob5 = 'ai', 1, 0)) AS ai,
           COUNT(DISTINCT blob3) AS countries
         FROM ${DATASET}
         WHERE blob1 = '${safeSlug}'
           AND timestamp > NOW() - INTERVAL '${interval}'`,
      ),
      this.runSql<{ referer: string; clicks: number }>(
        `SELECT blob2 AS referer, COUNT() AS clicks
         FROM ${DATASET}
         WHERE blob1 = '${safeSlug}'
           AND timestamp > NOW() - INTERVAL '${interval}'
           AND blob2 != ''
         GROUP BY blob2
         ORDER BY clicks DESC
         LIMIT 10`,
      ),
      this.runSql<{ country: string; clicks: number }>(
        `SELECT blob3 AS country, COUNT() AS clicks
         FROM ${DATASET}
         WHERE blob1 = '${safeSlug}'
           AND timestamp > NOW() - INTERVAL '${interval}'
           AND blob3 != ''
         GROUP BY blob3
         ORDER BY clicks DESC
         LIMIT 10`,
      ),
    ]);

    const t = totals[0] ?? { total: 0, ai: 0, countries: 0 };
    return {
      slug,
      period,
      totalClicks: Number(t.total),
      uniqueCountries: Number(t.countries),
      aiClicks: Number(t.ai),
      humanClicks: Number(t.total) - Number(t.ai),
      topReferers: referers.map((r) => ({
        referer: r.referer,
        clicks: Number(r.clicks),
      })),
      topCountries: countries.map((c) => ({
        country: c.country,
        clicks: Number(c.clicks),
      })),
    };
  }

  async getTimeseries(
    slug: string,
    period: Period,
    interval: Interval,
  ): Promise<TimeseriesPoint[]> {
    const periodInterval = periodToInterval(period);
    const bucket = interval === "1h" ? "HOUR" : "DAY";
    const safeSlug = escapeSql(slug);

    const rows = await this.runSql<{
      bucket: string;
      clicks: number;
      ai: number;
    }>(
      `SELECT
         toStartOf${bucket}(timestamp) AS bucket,
         COUNT() AS clicks,
         SUM(IF(blob5 = 'ai', 1, 0)) AS ai
       FROM ${DATASET}
       WHERE blob1 = '${safeSlug}'
         AND timestamp > NOW() - INTERVAL '${periodInterval}'
       GROUP BY bucket
       ORDER BY bucket ASC`,
    );

    return rows.map((r) => ({
      timestamp: new Date(r.bucket).toISOString(),
      clicks: Number(r.clicks),
      aiClicks: Number(r.ai),
    }));
  }

  async getTopLinks(period: Period, limit = 10): Promise<TopLink[]> {
    const interval = periodToInterval(period);
    const rows = await this.runSql<{ slug: string; clicks: number }>(
      `SELECT blob1 AS slug, COUNT() AS clicks
       FROM ${DATASET}
       WHERE timestamp > NOW() - INTERVAL '${interval}'
       GROUP BY blob1
       ORDER BY clicks DESC
       LIMIT ${Math.min(limit, 100)}`,
    );
    return rows.map((r) => ({ slug: r.slug, clicks: Number(r.clicks) }));
  }

  async getAiStats(period: Period): Promise<AiStats> {
    const interval = periodToInterval(period);

    const [totals, bots] = await Promise.all([
      this.runSql<{ total: number; ai: number }>(
        `SELECT
           COUNT() AS total,
           SUM(IF(blob5 = 'ai', 1, 0)) AS ai
         FROM ${DATASET}
         WHERE timestamp > NOW() - INTERVAL '${interval}'`,
      ),
      this.runSql<{ user_agent: string; clicks: number }>(
        `SELECT blob4 AS user_agent, COUNT() AS clicks
         FROM ${DATASET}
         WHERE blob5 = 'ai'
           AND timestamp > NOW() - INTERVAL '${interval}'
         GROUP BY blob4
         ORDER BY clicks DESC
         LIMIT 20`,
      ),
    ]);

    const t = totals[0] ?? { total: 0, ai: 0 };
    const total = Number(t.total);
    const ai = Number(t.ai);

    const aggregated = new Map<string, number>();
    for (const row of bots) {
      const bot = detectAiBot(row.user_agent) ?? "other";
      aggregated.set(bot, (aggregated.get(bot) ?? 0) + Number(row.clicks));
    }

    return {
      period,
      totalClicks: total,
      aiClicks: ai,
      humanClicks: total - ai,
      aiRatio: total > 0 ? ai / total : 0,
      byBot: Array.from(aggregated.entries())
        .map(([bot, clicks]) => ({ bot, clicks }))
        .sort((a, b) => b.clicks - a.clicks),
    };
  }
}

function periodToInterval(period: Period): string {
  switch (period) {
    case "1d":
      return "1 DAY";
    case "7d":
      return "7 DAY";
    case "30d":
      return "30 DAY";
    case "90d":
      return "90 DAY";
  }
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}
