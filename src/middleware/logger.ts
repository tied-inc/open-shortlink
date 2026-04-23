import type { MiddlewareHandler } from "hono";

// Minimal structured request logger. Emits a single JSON line per request.
// Errors are logged by the global onError handler rather than here, so the logger
// always sees the final response status.
export const requestLogger: MiddlewareHandler = async (c, next) => {
  const start = Date.now();
  const requestId =
    c.req.header("cf-ray") ??
    c.req.header("x-request-id") ??
    crypto.randomUUID();
  c.set("requestId", requestId);
  c.res.headers.set("X-Request-Id", requestId);

  await next();

  const duration = Date.now() - start;
  const url = new URL(c.req.url);
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: c.res.status >= 500 ? "error" : "info",
      requestId,
      method: c.req.method,
      path: url.pathname,
      status: c.res.status,
      durationMs: duration,
    }),
  );
};
