import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../bindings";

// Path classifier shared between the defaultHandler (app.ts) and the
// OAuthProvider's apiHandler (index.ts). "API-side" includes OAuth
// endpoints because an MCP client discovers and completes OAuth on the
// same host that serves /mcp.
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

// Host split: when REDIRECT_HOST / API_HOST are configured, each host only
// serves its intended surface. This prevents the API from being reachable
// on the short-link host (and vice versa) when routes are bound to multiple
// subdomains on the same worker.
//
// Applied to both the defaultHandler and the apiHandler so the protection
// holds for OAuth-protected /api/* and /mcp/* requests, not just for the
// paths that fall through to defaultHandler.
export const hostSplit: MiddlewareHandler<{ Bindings: Bindings }> = async (
  c,
  next,
) => {
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
};
