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

// On Cloudflare Workers only `cf-connecting-ip` is authoritative; any other
// forwarding header (x-forwarded-for, x-real-ip) is trivially spoofable and
// lets a client bypass per-IP limits by rotating the value per request.
// Fall back to the Cloudflare colo identifier so the bucket is still scoped
// to *something* Cloudflare attaches (cheap anti-abuse when the header is
// absent, e.g. local dev without the Cloudflare edge in front).
const DEFAULT_KEY = (c: Parameters<MiddlewareHandler>[0]) => {
  const cf = (c.req.raw as unknown as { cf?: IncomingRequestCfProperties }).cf;
  return c.req.header("cf-connecting-ip") ?? cf?.colo ?? "unknown";
};

// Hard cap on tracked buckets per isolate. Prevents unbounded memory growth
// if an attacker cycles through many distinct keys.
const MAX_BUCKETS = 10_000;

export function rateLimit(opts: RateLimitOptions): MiddlewareHandler {
  const buckets = new Map<string, Bucket>();
  const keyFn = opts.keyFn ?? DEFAULT_KEY;

  return async (c, next) => {
    const key = keyFn(c);
    const now = Date.now();

    // Opportunistic GC of expired buckets. Triggered only when we hit the cap
    // so the hot path stays O(1).
    if (buckets.size >= MAX_BUCKETS) {
      for (const [k, v] of buckets) {
        if (v.resetAt <= now) buckets.delete(k);
      }
      // If still over the cap (everyone is live), evict the oldest entries.
      if (buckets.size >= MAX_BUCKETS) {
        const excess = buckets.size - MAX_BUCKETS + 1;
        let i = 0;
        for (const k of buckets.keys()) {
          if (i++ >= excess) break;
          buckets.delete(k);
        }
      }
    }

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
