import { Hono } from "hono";
import { z } from "zod";
import type { Bindings } from "../bindings";
import { bearerAuth } from "../middleware/auth";
import { LinkStore } from "../storage/kv";
import {
  LinkConflictError,
  LinkNotFoundError,
  LinkService,
  LinkValidationError,
} from "../services/links";
import { AnalyticsQuery, type Period, type Interval } from "../analytics/query";

export const apiRoute = new Hono<{ Bindings: Bindings }>();

apiRoute.use("*", bearerAuth);

function getBaseUrl(c: { req: { url: string } }): string {
  const url = new URL(c.req.url);
  return `${url.protocol}//${url.host}`;
}

function getService(
  env: Bindings,
  baseUrl: string,
): LinkService {
  return new LinkService(new LinkStore(env.SHORTLINKS), baseUrl);
}

function getAnalytics(env: Bindings): AnalyticsQuery | null {
  if (!env.CF_ACCOUNT_ID || !env.CF_ANALYTICS_TOKEN) return null;
  return new AnalyticsQuery({
    accountId: env.CF_ACCOUNT_ID,
    apiToken: env.CF_ANALYTICS_TOKEN,
  });
}

const createSchema = z.object({
  url: z.string(),
  slug: z.string().optional(),
  expiresIn: z.number().int().positive().optional(),
});

apiRoute.post("/links", async (c) => {
  const body = await c.req.json().catch(() => null);
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid request body" }, 400);
  }

  const service = getService(c.env, getBaseUrl(c));
  try {
    const link = await service.create(parsed.data);
    return c.json(link, 201);
  } catch (err) {
    if (err instanceof LinkValidationError) {
      return c.json({ error: err.message }, 400);
    }
    if (err instanceof LinkConflictError) {
      return c.json({ error: err.message }, 409);
    }
    throw err;
  }
});

apiRoute.get("/links", async (c) => {
  const limit = Number(c.req.query("limit") ?? "20");
  const cursor = c.req.query("cursor");
  const service = getService(c.env, getBaseUrl(c));
  const result = await service.list(
    Number.isFinite(limit) ? limit : 20,
    cursor,
  );
  return c.json(result);
});

apiRoute.get("/links/:slug", async (c) => {
  const slug = c.req.param("slug");
  const service = getService(c.env, getBaseUrl(c));
  try {
    const link = await service.get(slug);
    return c.json(link);
  } catch (err) {
    if (err instanceof LinkNotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    throw err;
  }
});

apiRoute.delete("/links/:slug", async (c) => {
  const slug = c.req.param("slug");
  const service = getService(c.env, getBaseUrl(c));
  try {
    await service.delete(slug);
    return c.body(null, 204);
  } catch (err) {
    if (err instanceof LinkNotFoundError) {
      return c.json({ error: err.message }, 404);
    }
    throw err;
  }
});

// Analytics

const PERIODS: readonly Period[] = ["1d", "7d", "30d", "90d"];
const INTERVALS: readonly Interval[] = ["1h", "1d"];

function parsePeriod(input: string | undefined, fallback: Period = "7d"): Period {
  return (PERIODS as readonly string[]).includes(input ?? "")
    ? (input as Period)
    : fallback;
}

function parseInterval(
  input: string | undefined,
  fallback: Interval = "1d",
): Interval {
  return (INTERVALS as readonly string[]).includes(input ?? "")
    ? (input as Interval)
    : fallback;
}

function requireAnalytics(
  env: Bindings,
): AnalyticsQuery | Response {
  const analytics = getAnalytics(env);
  if (!analytics) {
    return new Response(
      JSON.stringify({
        error:
          "analytics query not configured (set CF_ACCOUNT_ID and CF_ANALYTICS_TOKEN)",
      }),
      { status: 503, headers: { "content-type": "application/json" } },
    );
  }
  return analytics;
}

apiRoute.get("/analytics/top", async (c) => {
  const a = requireAnalytics(c.env);
  if (a instanceof Response) return a;
  const period = parsePeriod(c.req.query("period"));
  const limit = Number(c.req.query("limit") ?? "10");
  const top = await a.getTopLinks(
    period,
    Number.isFinite(limit) ? limit : 10,
  );
  return c.json({ period, links: top });
});

apiRoute.get("/analytics/ai", async (c) => {
  const a = requireAnalytics(c.env);
  if (a instanceof Response) return a;
  const period = parsePeriod(c.req.query("period"));
  const stats = await a.getAiStats(period);
  return c.json(stats);
});

apiRoute.get("/analytics/:slug/timeseries", async (c) => {
  const a = requireAnalytics(c.env);
  if (a instanceof Response) return a;
  const slug = c.req.param("slug");
  const period = parsePeriod(c.req.query("period"));
  const interval = parseInterval(c.req.query("interval"));
  const data = await a.getTimeseries(slug, period, interval);
  return c.json({ slug, period, interval, data });
});

apiRoute.get("/analytics/:slug", async (c) => {
  const a = requireAnalytics(c.env);
  if (a instanceof Response) return a;
  const slug = c.req.param("slug");
  const period = parsePeriod(c.req.query("period"));
  const stats = await a.getSlugAnalytics(slug, period);
  return c.json(stats);
});
