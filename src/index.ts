import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { mcpHandlers } from "./mcp/server";
import app from "./app";

// ---------------------------------------------------------------------------
// API handler — receives /mcp requests that have a valid OAuth access token.
// OAuthProvider already validated the token so no bearer middleware needed.
// ---------------------------------------------------------------------------
const oauthMcpHandler = {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const handler = new Hono<{ Bindings: Bindings }>();
    handler.route("/mcp", mcpHandlers);
    return handler.fetch(request, env, ctx);
  },
};

// ---------------------------------------------------------------------------
// OAuthProvider wraps both handlers and adds OAuth endpoints automatically:
//   /.well-known/oauth-authorization-server — metadata discovery
//   /token   — token exchange (handled by OAuthProvider)
//   /register — dynamic client registration (handled by OAuthProvider)
//   /authorize — rendered by the defaultHandler (our Hono app above)
// ---------------------------------------------------------------------------
export default new OAuthProvider<Bindings>({
  apiRoute: "/mcp",
  apiHandler: oauthMcpHandler,
  defaultHandler: app,
  authorizeEndpoint: "/authorize",
  tokenEndpoint: "/token",
  clientRegistrationEndpoint: "/register",
  scopesSupported: ["mcp"],
  accessTokenTTL: 3600,
  refreshTokenTTL: 2592000,
});
