import type { MiddlewareHandler } from "hono";

// Permissive CORS for API and MCP endpoints. Adjust `Access-Control-Allow-Origin`
// if you want to restrict callers to specific origins.
export const cors: MiddlewareHandler = async (c, next) => {
  if (c.req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }
  await next();
  const headers = corsHeaders();
  for (const [k, v] of Object.entries(headers)) {
    c.res.headers.set(k, v);
  }
};

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization, Content-Type, Mcp-Session-Id",
    "Access-Control-Max-Age": "86400",
  };
}
