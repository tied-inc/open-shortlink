import type { MiddlewareHandler } from "hono";

// Baseline security response headers. Applied to every response so the Worker
// ships safe defaults regardless of the route. Tuned for a JSON-API / redirect
// service with no first-party HTML: no CSP is needed, but we still want
// browsers and intermediate proxies to treat responses conservatively.
export const securityHeaders: MiddlewareHandler = async (c, next) => {
  await next();
  const h = c.res.headers;
  if (!h.has("X-Content-Type-Options")) h.set("X-Content-Type-Options", "nosniff");
  if (!h.has("X-Frame-Options")) h.set("X-Frame-Options", "DENY");
  if (!h.has("Referrer-Policy")) h.set("Referrer-Policy", "no-referrer");
  if (!h.has("Strict-Transport-Security")) {
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  if (!h.has("Cross-Origin-Opener-Policy")) {
    h.set("Cross-Origin-Opener-Policy", "same-origin");
  }
  if (!h.has("Cross-Origin-Resource-Policy")) {
    h.set("Cross-Origin-Resource-Policy", "same-origin");
  }
  if (!h.has("Permissions-Policy")) {
    h.set("Permissions-Policy", "interest-cohort=()");
  }
};
