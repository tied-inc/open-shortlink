import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../bindings";

// Constant-time string comparison to avoid timing attacks on token checks.
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export const bearerAuth: MiddlewareHandler<{ Bindings: Bindings }> = async (
  c,
  next,
) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!c.env.API_TOKEN || !timingSafeEqual(token, c.env.API_TOKEN)) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
};
