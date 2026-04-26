import { OAuthProvider } from "@cloudflare/workers-oauth-provider";
import type { Bindings } from "./bindings";
import { authenticatedApp } from "./api-handler";
import app from "./app";
import { hostSplitDecision } from "./middleware/host-split";

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
const oauth = new OAuthProvider<Bindings>({
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

// Outer host-split gate. Required because OAuthProvider services its own
// endpoints (/token, /register, /.well-known/*) at the outermost layer
// before any of our Hono middleware runs. Without this wrapper those
// paths would be reachable on REDIRECT_HOST despite the host-split
// configuration. The Hono-level `hostSplit` middleware on app.ts and
// api-handler.ts still runs as defense-in-depth and is what the unit
// tests exercise.
export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    if (hostSplitDecision(new URL(request.url), env) === "deny") {
      return new Response(JSON.stringify({ error: "not found" }), {
        status: 404,
        headers: { "content-type": "application/json" },
      });
    }
    return oauth.fetch(request, env, ctx);
  },
};
