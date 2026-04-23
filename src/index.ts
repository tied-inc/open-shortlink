import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { apiRoute } from "./routes/api";
import { redirectRoute } from "./routes/redirect";
import { mcpRoute } from "./mcp/server";
import { cors } from "./middleware/cors";
import { requestLogger } from "./middleware/logger";
import { rateLimit } from "./middleware/rate-limit";
import { securityHeaders } from "./middleware/security-headers";

const app = new Hono<{ Bindings: Bindings }>();

app.use("*", requestLogger);
app.use("*", securityHeaders);
app.use("/api/*", cors);
app.use("/mcp", cors);
app.use("/mcp/*", cors);

// Per-IP rate limits. Redirect path gets a much higher cap since it's the hot path.
app.use("/api/*", rateLimit({ windowMs: 60_000, max: 120 }));
app.use("/mcp", rateLimit({ windowMs: 60_000, max: 120 }));
app.use("/mcp/*", rateLimit({ windowMs: 60_000, max: 120 }));

app.get("/", (c) =>
  c.json({
    name: "open-shortlink",
    description: "Open source URL shortener on Cloudflare Workers",
    docs: "https://github.com/tied-inc/open-shortlink",
  }),
);

app.get("/health", (c) => c.json({ status: "ok" }));

app.route("/api", apiRoute);
app.route("/mcp", mcpRoute);
app.route("/", redirectRoute);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  const requestId = c.get("requestId" as never);
  console.error(
    JSON.stringify({
      level: "error",
      requestId,
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
    }),
  );
  return c.json(
    { error: "internal server error", requestId },
    500,
  );
});

export default app;
