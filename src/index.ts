import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { apiRoute } from "./routes/api";
import { redirectRoute } from "./routes/redirect";
import { mcpRoute } from "./mcp/server";
import { cors } from "./middleware/cors";
import { requestLogger } from "./middleware/logger";
import { rateLimit } from "./middleware/rate-limit";
import { securityHeaders } from "./middleware/security-headers";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", requestLogger);
app.use("*", securityHeaders);
app.use("/api/*", cors);
app.use("/mcp", cors);
app.use("/mcp/*", cors);

// Per-IP rate limits. Redirect path gets a much higher cap since it's the hot path.
app.use("/api/*", rateLimit({ windowMs: 60_000, max: 120 }));
app.use("/mcp", rateLimit({ windowMs: 60_000, max: 120 }));
app.use("/mcp/*", rateLimit({ windowMs: 60_000, max: 120 }));

// Host split: when REDIRECT_HOST / API_HOST are configured, each host only
// serves its intended surface. This prevents the API from being reachable on
// the short-link host (and vice versa) when routes are bound to multiple
// subdomains on the same worker.
function isApiOrMcpPath(path: string): boolean {
  return (
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/mcp" ||
    path.startsWith("/mcp/")
  );
}

app.use("*", async (c, next) => {
  const { REDIRECT_HOST, API_HOST } = c.env;
  if (!REDIRECT_HOST && !API_HOST) return next();
  const host = new URL(c.req.url).host;
  const path = c.req.path;
  if (REDIRECT_HOST && host === REDIRECT_HOST && isApiOrMcpPath(path)) {
    return c.json({ error: "not found" }, 404);
  }
  if (
    API_HOST &&
    host === API_HOST &&
    !isApiOrMcpPath(path) &&
    path !== "/" &&
    path !== "/health"
  ) {
    return c.json({ error: "not found" }, 404);
  }
  return next();
});

app.get("/", (c) =>
  c.json({
    name: "open-shortlink",
    description: "Open source URL shortener on Cloudflare Workers",
    docs: "https://github.com/tied-inc/open-shortlink",
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

// Conventional paths served directly so they never fall through to `/:slug`.
app.get("/robots.txt", () =>
  new Response("User-agent: *\nDisallow: /\n", {
    headers: { "content-type": "text/plain; charset=utf-8" },
  }),
);
app.get("/favicon.ico", () => new Response(null, { status: 204 }));

app.route("/api", apiRoute);
app.route("/mcp", mcpRoute);
app.route("/", redirectRoute);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  const requestId = c.get("requestId" as never);
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return c.json(
    { error: "internal server error", requestId },
    500,
  );
});

export default app;
