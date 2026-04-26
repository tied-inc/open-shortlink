import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { handleAuthorize, handleOauthCallback } from "./oauth/authorize";
import { redirectRoute } from "./routes/redirect";
import { hostSplit } from "./middleware/host-split";
import { requestLogger } from "./middleware/logger";
import { securityHeaders } from "./middleware/security-headers";

// ---------------------------------------------------------------------------
// The core Hono application. Used as the OAuthProvider's defaultHandler in
// src/index.ts and imported directly by tests (which cannot load the
// cloudflare:workers module that OAuthProvider depends on).
//
// This handler serves: redirects (/:slug), conventional paths (/robots.txt,
// /favicon.ico), health/info (/, /health), and OAuth browser endpoints
// (/authorize, /oauth/callback). The /api/* and /mcp/* surfaces live behind
// OAuthProvider's apiHandler in index.ts and never reach here.
// ---------------------------------------------------------------------------
const app = new Hono<{ Bindings: Bindings }>();

app.use("*", requestLogger);
app.use("*", securityHeaders);
app.use("*", hostSplit);

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

// OAuth authorize entry point. Delegates to the configured upstream IdP
// (Cloudflare Access or generic OIDC). See src/oauth/authorize.ts.
app.get("/authorize", (c) =>
  handleAuthorize(c.req.raw, c.env as Parameters<typeof handleAuthorize>[1]),
);
app.post("/authorize", (c) =>
  handleAuthorize(c.req.raw, c.env as Parameters<typeof handleAuthorize>[1]),
);

// OIDC callback — only reached when OIDC_ISSUER is configured. The upstream
// IdP redirects the browser here with ?code=...&state=... after sign-in.
app.get("/oauth/callback", (c) =>
  handleOauthCallback(
    c.req.raw,
    c.env as Parameters<typeof handleOauthCallback>[1],
  ),
);

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
