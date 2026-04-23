import { z } from "zod";
import type { Bindings } from "../bindings";
import { LinkStore } from "../storage/kv";
import { LinkService } from "../services/links";
import { AnalyticsQuery, type Period, type Interval } from "../analytics/query";

export interface ToolContext {
  env: Bindings;
  baseUrl: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler: (
    args: Record<string, unknown>,
    ctx: ToolContext,
  ) => Promise<unknown>;
}

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
    handler: async (args, ctx) => {
      const input = createLinkArgs.parse(args);
      return linkService(ctx).create(input);
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
    handler: async (args, ctx) => {
      const input = slugArgs.parse(args);
      return linkService(ctx).get(input.slug);
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
    handler: async (args, ctx) => {
      const input = slugArgs.parse(args);
      await linkService(ctx).delete(input.slug);
      return { deleted: input.slug };
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
          enum: ["1d", "7d", "30d", "90d"],
          description: "集計期間（デフォルト 7d）",
        },
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
    name: "get_top_links",
    description: "クリック数の多い短縮 URL のランキングを取得する",
    inputSchema: {
      type: "object",
      properties: {
        period: {
          type: "string",
          enum: ["1d", "7d", "30d", "90d"],
          description: "集計期間（デフォルト 7d）",
        },
        limit: { type: "number", description: "取得件数（デフォルト 10）" },
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
          enum: ["1d", "7d", "30d", "90d"],
          description: "集計期間（デフォルト 7d）",
        },
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
