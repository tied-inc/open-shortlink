import { Hono } from "hono";
import type { Bindings } from "./bindings";
import { apiRoute } from "./routes/api";
import { redirectRoute } from "./routes/redirect";
import { mcpRoute } from "./mcp/server";

const app = new Hono<{ Bindings: Bindings }>();

app.get("/", (c) =>
  c.json({
    name: "open-shortlink",
    description: "Open source URL shortener on Cloudflare Workers",
    docs: "https://github.com/tied-inc/open-shortlink",
  }),
);

app.route("/api", apiRoute);
app.route("/mcp", mcpRoute);
app.route("/", redirectRoute);

app.notFound((c) => c.json({ error: "not found" }, 404));
app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "internal server error" }, 500);
});

export default app;
