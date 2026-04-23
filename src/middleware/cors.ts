import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../bindings";

// CORS policy for API and MCP endpoints.
//
// Default: `Access-Control-Allow-Origin: *` (open, safe because every API
// route requires a Bearer token and browsers ignore `*` for credentialed
// requests).
//
// Operators can pin allowed origins by setting `CORS_ALLOW_ORIGIN` to a
// comma-separated list (e.g. `https://ui.example.com,https://admin.example.com`)
// or the literal string `*`. Unknown origins receive no
// `Access-Control-Allow-Origin` header and their preflight returns 403.
export const cors: MiddlewareHandler<{ Bindings: Bindings }> = async (
  c,
  next,
) => {
  const reqOrigin = c.req.header("origin") ?? "";
  const allowlist = c.env?.CORS_ALLOW_ORIGIN;
  const allowed = resolveAllowedOrigin(allowlist, reqOrigin);

  if (c.req.method === "OPTIONS") {
    if (!allowed) {
      return new Response(null, { status: 403 });
    }
    return new Response(null, {
      status: 204,
      headers: corsHeaders(allowed),
    });
  }

  await next();

  if (allowed) {
    const headers = corsHeaders(allowed);
    for (const [k, v] of Object.entries(headers)) {
      c.res.headers.set(k, v);
    }
  }
};

function resolveAllowedOrigin(
  allowlist: string | undefined,
  reqOrigin: string,
): string | null {
  // Not configured => treat as fully open for backwards compatibility. The API
  // is token-authed so `*` is still safe, but we'll echo a specific origin
  // when the client sends one so future auth schemes (cookies, etc.) stay
  // safe by default.
  if (!allowlist || allowlist.trim() === "") {
    return reqOrigin || "*";
  }
  const list = allowlist.split(",").map((s) => s.trim()).filter(Boolean);
  if (list.includes("*")) return reqOrigin || "*";
  if (!reqOrigin) return null;
  if (list.includes(reqOrigin)) return reqOrigin;
  return null;
}

function corsHeaders(origin: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };
  // Echoed origins must advertise that they vary per Origin, otherwise CDN
  // caches will serve the wrong CORS response to a different origin.
  if (origin !== "*") {
    headers["Vary"] = "Origin";
  }
  return headers;
}
