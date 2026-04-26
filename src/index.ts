import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { Bindings } from "./bindings";
import { authenticatedApp } from "./api-handler";
import app from "./app";

// ---------------------------------------------------------------------------
// API handler — receives /api/* and /mcp/* requests that already have a valid
// OAuth access token. OAuthProvider performs the token validation before
// calling into this handler, so no bearer middleware is needed downstream.
//
// The Hono app is built once in src/api-handler.ts so stateful middleware
// (rateLimit's in-memory buckets) persists across requests on the same
// isolate. The thin wrapper here just adapts it to the
// ExportedHandler-with-fetch shape that OAuthProvider expects.
// ---------------------------------------------------------------------------
const authenticatedHandler = {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    return authenticatedApp.fetch(request, env, ctx);
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
