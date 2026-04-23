import { Hono } from "hono";
import type { Bindings } from "../bindings";
import { trackClick } from "../analytics/tracker";
import { LinkStore } from "../storage/kv";

export const redirectRoute = new Hono<{ Bindings: Bindings }>();

redirectRoute.get("/:slug", async (c) => {
  const slug = c.req.param("slug");
  const store = new LinkStore(c.env.SHORTLINKS);
  const link = await store.get(slug);
  if (!link) return c.notFound();

  const req = c.req.raw;
  const cf = (req as unknown as { cf?: IncomingRequestCfProperties }).cf;

  c.executionCtx.waitUntil(
    Promise.resolve(
      trackClick(c.env.ANALYTICS, {
        slug,
        referer: req.headers.get("referer") ?? "",
        country: cf?.country ?? "",
        userAgent: req.headers.get("user-agent") ?? "",
      }),
    ),
  );

  return c.redirect(link.url, 302);
});
