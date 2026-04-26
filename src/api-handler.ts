import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { mcpHandlers } from "./mcp/server";
import { apiRoute } from "./routes/api";
import { cors } from "./middleware/cors";
import { hostSplit } from "./middleware/host-split";
import { requestLogger } from "./middleware/logger";
import { rateLimit } from "./middleware/rate-limit";
import { securityHeaders } from "./middleware/security-headers";

// ---------------------------------------------------------------------------
// The authenticated Hono app that runs behind OAuthProvider's apiHandler.
// Receives /api/* and /mcp/* requests *after* the OAuth access token has
// been validated, so no bearer middleware is needed downstream.
//
// Built once at module load (NOT inside the OAuthProvider apiHandler's
// fetch()) so stateful middleware — notably rateLimit's in-memory buckets —
// persist across requests on the same isolate. Rebuilding the Hono app
// per request would reset the limiter on every call.
//
// Lives in its own module so it can be imported by tests directly without
// pulling in @cloudflare/workers-oauth-provider (which depends on
// `cloudflare:workers` and cannot load in `bun test`).
// ---------------------------------------------------------------------------
export function buildAuthenticatedApp(): Hono<{ Bindings: Bindings }> {
  const app = new Hono<{ Bindings: Bindings }>();

  // Logs and base hardening apply to every authenticated request.
  app.use("*", requestLogger);
  app.use("*", securityHeaders);

  // Host split must also run here; without it, /api/* and /mcp/* on
  // REDIRECT_HOST would be served instead of returning 404.
  app.use("*", hostSplit);

  // CORS only applies to the REST surface. MCP clients are not browsers and
  // do not perform CORS preflight against /mcp.
  app.use("/api/*", cors);

  // Per-IP rate limits. Two distinct limiter instances so /api and /mcp
  // don't share a bucket (an attacker hammering /mcp shouldn't deny /api
  // requests), but /mcp and /mcp/* share a single instance to enforce one
  // combined cap.
  const apiRateLimit = rateLimit({ windowMs: 60_000, max: 120 });
  const mcpRateLimit = rateLimit({ windowMs: 60_000, max: 120 });
  app.use("/api/*", apiRateLimit);
  app.use("/mcp", mcpRateLimit);
  app.use("/mcp/*", mcpRateLimit);

  app.route("/api", apiRoute);
  app.route("/mcp", mcpHandlers);

  return app;
}

export const authenticatedApp = buildAuthenticatedApp();
