import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../bindings";

// Path classifier shared between the defaultHandler (app.ts), the
// OAuthProvider's apiHandler (api-handler.ts), and the outer Worker entry
// (index.ts). "API-side" includes OAuth endpoints because an MCP client
// discovers and completes OAuth on the same host that serves /mcp.
export function isApiOrMcpPath(path: string): boolean {
  return (
    path === "/api" ||
    path.startsWith("/api/") ||
    path === "/mcp" ||
    path.startsWith("/mcp/") ||
    path === "/authorize" ||
    path === "/oauth/callback" ||
    path === "/token" ||
    path === "/register" ||
    path.startsWith("/.well-known/")
  );
}

// Pure decision function — used both inside Hono middleware (below) and
// at the outer Worker entry to gate requests *before* OAuthProvider gets
// to handle its built-in endpoints (/token, /register, /.well-known/*).
// Without an outer check, those paths would be reachable on REDIRECT_HOST
// because OAuthProvider intercepts before any Hono middleware runs.
export function hostSplitDecision(
  url: URL,
  env: Pick<Bindings, "REDIRECT_HOST" | "API_HOST">,
): "allow" | "deny" {
  const { REDIRECT_HOST, API_HOST } = env;
  if (!REDIRECT_HOST && !API_HOST) return "allow";
  const path = url.pathname;
  if (REDIRECT_HOST && url.host === REDIRECT_HOST && isApiOrMcpPath(path)) {
    return "deny";
  }
  if (
    API_HOST &&
    url.host === API_HOST &&
    !isApiOrMcpPath(path) &&
    path !== "/" &&
    path !== "/health"
  ) {
    return "deny";
  }
  return "allow";
}

// Host split: when REDIRECT_HOST / API_HOST are configured, each host only
// serves its intended surface. This prevents the API from being reachable
// on the short-link host (and vice versa) when routes are bound to multiple
// subdomains on the same worker.
//
// Applied to both the defaultHandler and the apiHandler so the protection
// holds for OAuth-protected /api/* and /mcp/* requests, not just for the
// paths that fall through to defaultHandler. The outer Worker entry in
// src/index.ts uses `hostSplitDecision` directly to also cover the paths
// that OAuthProvider serves itself.
export const hostSplit: MiddlewareHandler<{ Bindings: Bindings }> = async (
  c,
  next,
) => {
  const url = new URL(c.req.url);
  if (hostSplitDecision(url, c.env) === "deny") {
    return c.json({ error: "not found" }, 404);
  }
  return next();
};
