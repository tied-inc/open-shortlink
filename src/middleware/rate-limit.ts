import type { MiddlewareHandler } from "hono";

// Per-isolate in-memory rate limiter. State is NOT shared between Worker
// isolates — each Cloudflare region/isolate keeps its own counter, so a
// determined attacker distributed across many edges can exceed the intended
// global rate.
//
// This is intentional: the limiter serves as a local spike guard (protects a
// single isolate from burst abuse and cheap retries from one client) while
// global enforcement is delegated to Cloudflare Rate Limiting Rules
// configured at the zone/route level via the dashboard. See
// docs/guide/deploy.md ("レート制限") for the recommended configuration.
//
// Trade-offs of alternatives considered:
//   - Durable Objects: strongly consistent global counter, but adds a
//     round-trip on every request and costs extra on the Workers paid plan.
//   - KV: eventually-consistent counter, cheap but too loose to meaningfully
//     limit bursts at the edge.
//   - Cloudflare Rate Limiting Rules (chosen): managed, global, zero code,
//     configured per-route in the Cloudflare dashboard.

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
