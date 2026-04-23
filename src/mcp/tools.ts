import { z } from "zod";
import type { Bindings } from "../bindings";
import { LinkStore } from "../storage/kv";
import {
  LinkConflictError,
  LinkNotFoundError,
  LinkService,
  LinkValidationError,
} from "../services/links";
import { AnalyticsQuery, type Interval, type Period } from "../analytics/query";

export interface ToolContext {
  env: Bindings;
  baseUrl: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown>;
}

const linkResponseSchema = {
  type: "object",
  required: ["slug", "url", "shortUrl", "createdAt"],
  properties: {
    slug: { type: "string" },
    url: { type: "string" },
    shortUrl: { type: "string" },
    createdAt: { type: "number" },
    expiresAt: { type: "number" },
  },
} as const;

const periodEnum = ["1d", "7d", "30d", "90d"] as const;

const countsByKeySchema = (key: string) =>
  ({
    type: "array",
    items: {
      type: "object",
      required: [key, "clicks"],
      properties: {
        [key]: { type: "string" },
        clicks: { type: "number" },
      },
    },
  }) as const;

function linkService(ctx: ToolContext): LinkService {
  return new LinkService(new LinkStore(ctx.env.SHORTLINKS), ctx.baseUrl);
}

function analytics(ctx: ToolContext): AnalyticsQuery {
  if (!ctx.env.CF_ACCOUNT_ID || !ctx.env.CF_ANALYTICS_TOKEN) {
    throw new Error(
      "Analytics query is not configured. Set CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN.",
    );
  }
  return new AnalyticsQuery({
    accountId: ctx.env.CF_ACCOUNT_ID,
    apiToken: ctx.env.CF_ANALYTICS_TOKEN,
  });
}

const periodSchema = z.enum(["1d", "7d", "30d", "90d"]).default("7d");
const intervalSchema = z.enum(["1h", "1d"]).default("1d");
const intervalEnum = ["1h", "1d"] as const;

const createLinkArgs = z.object({
  url: z.string(),
  slug: z.string().optional(),
  expiresIn: z.number().int().positive().optional(),
});

const listLinksArgs = z.object({
  limit: z.number().int().positive().max(100).optional(),
  cursor: z.string().optional(),
});

const slugArgs = z.object({ slug: z.string() });

const analyticsArgs = z.object({
  slug: z.string(),
  period: periodSchema.optional(),
});

const timeseriesArgs = z.object({
  slug: z.string(),
  period: periodSchema.optional(),
  interval: intervalSchema.optional(),
});

const topLinksArgs = z.object({
  period: periodSchema.optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const aiStatsArgs = z.object({
  period: periodSchema.optional(),
});

export const tools: ToolDefinition[] = [
  {
    name: "create_link",
    description: "短縮 URL を作成する",
    inputSchema: {
      type: "object",
      required: ["url"],
      properties: {
        url: { type: "string", description: "短縮対象の URL" },
        slug: { type: "string", description: "カスタムスラッグ（省略可）" },
        expiresIn: {
          type: "number",
          description: "有効期限（秒）。省略時は無期限",
        },
      },
    },
    outputSchema: linkResponseSchema,
    handler: async (args, ctx) => {
      const input = createLinkArgs.parse(args);
      try {
        return await linkService(ctx).create(input);
      } catch (err) {
        if (
          err instanceof LinkValidationError ||
          err instanceof LinkConflictError
        ) {
          throw new Error(err.message);
        }
        throw err;
      }
    },
  },
  {
    name: "list_links",
    description: "短縮 URL の一覧を取得する",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "取得件数（デフォルト 20）" },
        cursor: { type: "string", description: "ページネーションカーソル" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["links"],
      properties: {
        links: { type: "array", items: linkResponseSchema },
        cursor: { type: "string" },
      },
    },
    handler: async (args, ctx) => {
      const input = listLinksArgs.parse(args);
      return linkService(ctx).list(input.limit, input.cursor);
    },
  },
  {
    name: "get_link",
    description: "特定の短縮 URL の詳細を取得する",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", description: "対象の slug" },
      },
    },
    outputSchema: linkResponseSchema,
    handler: async (args, ctx) => {
      const input = slugArgs.parse(args);
      try {
        return await linkService(ctx).get(input.slug);
      } catch (err) {
        if (err instanceof LinkNotFoundError) throw new Error(err.message);
        throw err;
      }
    },
  },
  {
    name: "delete_link",
    description: "短縮 URL を削除する",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string", description: "対象の slug" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["deleted"],
      properties: { deleted: { type: "string" } },
    },
    handler: async (args, ctx) => {
      const input = slugArgs.parse(args);
      try {
        await linkService(ctx).delete(input.slug);
        return { deleted: input.slug };
      } catch (err) {
        if (err instanceof LinkNotFoundError) throw new Error(err.message);
        throw err;
      }
    },
  },
  {
    name: "get_analytics",
    description: "特定の slug のクリック統計を取得する",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string" },
        period: {
          type: "string",
          enum: periodEnum,
          description: "集計期間（デフォルト 7d）",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "slug",
        "period",
        "totalClicks",
        "uniqueCountries",
        "aiClicks",
        "humanClicks",
        "topReferers",
        "topCountries",
      ],
      properties: {
        slug: { type: "string" },
        period: { type: "string", enum: periodEnum },
        totalClicks: { type: "number" },
        uniqueCountries: { type: "number" },
        aiClicks: { type: "number" },
        humanClicks: { type: "number" },
        topReferers: countsByKeySchema("referer"),
        topCountries: countsByKeySchema("country"),
      },
    },
    handler: async (args, ctx) => {
      const input = analyticsArgs.parse(args);
      return analytics(ctx).getSlugAnalytics(
        input.slug,
        input.period ?? "7d",
      );
    },
  },
  {
    name: "get_timeseries",
    description: "特定の slug の時系列クリックデータを取得する",
    inputSchema: {
      type: "object",
      required: ["slug"],
      properties: {
        slug: { type: "string" },
        period: {
          type: "string",
          enum: periodEnum,
          description: "集計期間（デフォルト 7d）",
        },
        interval: {
          type: "string",
          enum: intervalEnum,
          description: "集計間隔（デフォルト 1d）",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: ["slug", "period", "interval", "data"],
      properties: {
        slug: { type: "string" },
        period: { type: "string", enum: periodEnum },
        interval: { type: "string", enum: intervalEnum },
        data: {
          type: "array",
          items: {
            type: "object",
            required: ["timestamp", "clicks", "aiClicks"],
            properties: {
              timestamp: { type: "string" },
              clicks: { type: "number" },
              aiClicks: { type: "number" },
            },
          },
        },
      },
    },
    handler: async (args, ctx) => {
      const input = timeseriesArgs.parse(args);
      const period: Period = input.period ?? "7d";
      const interval: Interval = input.interval ?? "1d";
      const data = await analytics(ctx).getTimeseries(
        input.slug,
        period,
        interval,
      );
      return { slug: input.slug, period, interval, data };
    },
  },
  {
    name: "get_top_links",
    description: "クリック数の多い短縮 URL のランキングを取得する",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: periodEnum,
          description: "集計期間（デフォルト 7d）",
        },
        limit: { type: "number", description: "取得件数（デフォルト 10）" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["period", "links"],
      properties: {
        period: { type: "string", enum: periodEnum },
        links: countsByKeySchema("slug"),
      },
    },
    handler: async (args, ctx) => {
      const input = topLinksArgs.parse(args);
      const period = input.period ?? "7d";
      const links = await analytics(ctx).getTopLinks(period, input.limit);
      return { period, links };
    },
  },
  {
    name: "get_ai_stats",
    description: "AI アクセスの統計を取得する",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: periodEnum,
          description: "集計期間（デフォルト 7d）",
        },
      },
    },
    outputSchema: {
      type: "object",
      required: [
        "period",
        "totalClicks",
        "aiClicks",
        "humanClicks",
        "aiRatio",
        "byBot",
      ],
      properties: {
        period: { type: "string", enum: periodEnum },
        totalClicks: { type: "number" },
        aiClicks: { type: "number" },
        humanClicks: { type: "number" },
        aiRatio: { type: "number" },
        byBot: countsByKeySchema("bot"),
      },
    },
    handler: async (args, ctx) => {
      const input = aiStatsArgs.parse(args);
      return analytics(ctx).getAiStats(input.period ?? "7d");
    },
  },
];

export const toolMap: Map<string, ToolDefinition> = new Map(
  tools.map((t) => [t.name, t]),
);
