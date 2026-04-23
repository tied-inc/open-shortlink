import type { MiddlewareHandler } from "hono";

// Simple in-memory sliding-window rate limit. Runs per Worker isolate.
// Sufficient for basic abuse mitigation on a single-tenant deployment;
// for global limits use Cloudflare's Rate Limiting Rules via the dashboard.

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyFn?: (c: Parameters<MiddlewareHandler>[0]) => string;
}

interface Bucket {
  count: number;
  resetAt: number;
}

const DEFAULT_KEY = (c: Parameters<MiddlewareHandler>[0]) => {
  const cf = (c.req.raw as unknown as { cf?: IncomingRequestCfProperties }).cf;
  return (
    c.req.header("cf-connecting-ip") ??
    c.req.header("x-forwarded-for") ??
    cf?.colo ??
    "unknown"
  );
};

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const keyFn = opts.keyFn ?? DEFAULT_KEY;

  return async (c, next) => {
    const key = keyFn(c);
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;

    const remaining = Math.max(0, opts.max - bucket.count);
    c.res.headers.set("X-RateLimit-Limit", String(opts.max));
    c.res.headers.set("X-RateLimit-Remaining", String(remaining));
    c.res.headers.set(
      "X-RateLimit-Reset",
      String(Math.ceil(bucket.resetAt / 1000)),
    );

    if (bucket.count > opts.max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      return c.json(
        { error: "rate limit exceeded", retryAfter },
        429,
        { "Retry-After": String(retryAfter) },
      );
    }

    return next();
  };
}
