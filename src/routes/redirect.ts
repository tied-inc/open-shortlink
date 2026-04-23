import { Hono } from "hono";
import type { Bindings } from "../bindings";
import { trackClick, type ClickEvent } from "../analytics/tracker";
import { LinkStore } from "../storage/kv";

export const redirectRoute = new Hono<{ Bindings: Bindings }>();

// Edge cache TTL for 302 responses. Short enough that deletes/rotations
// propagate quickly via natural expiry even if an explicit purge is missed;
// long enough to absorb burst traffic to hot slugs.
const EDGE_CACHE_TTL_SECONDS = 60;

redirectRoute.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const req = c.req.raw;
  const cf = (req as unknown as { cf?: IncomingRequestCfProperties }).cf;
  const country = cf?.country ?? "";

  const event: ClickEvent = {
    slug,
    referer: req.headers.get("referer") ?? "",
    country,
    userAgent: req.headers.get("user-agent") ?? "",
  };
  const scheduleTrack = () => {
    c.executionCtx.waitUntil(
      Promise.resolve(trackClick(c.env.ANALYTICS, event)),
    );
  };

  // Cache API is only available in the Workers runtime; skip transparently
  // in non-Worker environments (e.g. unit tests).
  const cache = (globalThis as { caches?: CacheStorage }).caches?.default;

  // Cache reads are safe: we only ever write non-geo responses to the cache
  // (see below), so any cache hit is guaranteed to be country-independent.
  if (cache) {
    const cached = await cache.match(req);
    if (cached) {
      // Worker still runs on cache hits, so analytics are preserved.
      scheduleTrack();
      return cached;
    }
  }

  const store = new LinkStore(c.env.SHORTLINKS);
  const link = await store.get(slug);
  if (!link) return c.notFound();

  scheduleTrack();

  const hasGeo = link.geo !== undefined && Object.keys(link.geo).length > 0;
  const target = hasGeo ? (link.geo![country] ?? link.url) : link.url;

  const response = new Response(null, {
    status: 302,
    headers: {
      location: target,
      // Geo-variant responses must never be shared across viewers, since the
      // edge cache key does not distinguish country. Plain links get the
      // usual short edge TTL.
      "cache-control": hasGeo
        ? "private, no-store"
        : `public, max-age=0, s-maxage=${EDGE_CACHE_TTL_SECONDS}`,
    },
  });

  if (cache && !hasGeo) {
    c.executionCtx.waitUntil(cache.put(req, response.clone()));
  }

  return response;
});
