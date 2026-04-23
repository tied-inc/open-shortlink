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

  const event: ClickEvent = {
    slug,
    referer: req.headers.get("referer") ?? "",
    country: cf?.country ?? "",
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

  const response = new Response(null, {
    status: 302,
    headers: {
      location: link.url,
      // Edge-only cache: don't let browsers pin a 302 aggressively.
      "cache-control": `public, max-age=0, s-maxage=${EDGE_CACHE_TTL_SECONDS}`,
    },
  });

  if (cache) {
    c.executionCtx.waitUntil(cache.put(req, response.clone()));
  }

  return response;
});
