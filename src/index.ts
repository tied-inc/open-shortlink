import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { mcpHandlers } from "./mcp/server";
import { apiRoute } from "./routes/api";
import app from "./app";

// ---------------------------------------------------------------------------
// API handler — receives /api/* and /mcp/* requests that already have a valid
// OAuth access token. OAuthProvider performs the token validation before
// calling into this handler, so no bearer middleware is needed downstream.
// ---------------------------------------------------------------------------
const authenticatedHandler = {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const handler = new Hono<{ Bindings: Bindings }>();
    handler.route("/api", apiRoute);
    handler.route("/mcp", mcpHandlers);
    return handler.fetch(request, env, ctx);
  },
};

// ---------------------------------------------------------------------------
// OAuthProvider wraps both handlers and adds OAuth endpoints automatically:
//   /.well-known/oauth-authorization-server — metadata discovery
//   /.well-known/oauth-protected-resource   — RFC 9728 resource metadata
//   /token     — token exchange
//   /register  — dynamic client registration
//   /authorize — rendered by the defaultHandler (delegates to IdP)
// ---------------------------------------------------------------------------
export default new OAuthProvider<Bindings>({
  apiRoute: ["/api", "/mcp"],
  apiHandler: authenticatedHandler,
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
});
