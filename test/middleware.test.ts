import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { rateLimit } from "../src/middleware/rate-limit";
import { cors } from "../src/middleware/cors";
import { bearerAuth } from "../src/middleware/auth";
import { createTestCtx, createTestEnv } from "./helpers/test-app";

describe("rateLimit", () => {
  test("allows requests under the limit", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({ windowMs: 60_000, max: 3, keyFn: () => "fixed" }),
    );
    app.get("/", (c) => c.text("ok"));

    for (let i = 0; i < 3; i++) {
      const res = await app.request("/");
      expect(res.status).toBe(200);
      expect(res.headers.get("X-RateLimit-Limit")).toBe("3");
    }
  });

  test("blocks once limit is exceeded", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({ windowMs: 60_000, max: 2, keyFn: () => "fixed" }),
    );
    app.get("/", (c) => c.text("ok"));

    await app.request("/");
    await app.request("/");
    const res = await app.request("/");
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBeDefined();
  });

  test("isolates different keys", async () => {
    let key = "a";
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, max: 1, keyFn: () => key }));
    app.get("/", (c) => c.text("ok"));

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(429);
    key = "b";
    expect((await app.request("/")).status).toBe(200);
  });

  test("resets after the window elapses", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({ windowMs: 10, max: 1, keyFn: () => "fixed" }),
    );
    app.get("/", (c) => c.text("ok"));

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(429);
    await new Promise((resolve) => setTimeout(resolve, 15));
    expect((await app.request("/")).status).toBe(200);
  });

  test("falls back to CF-Connecting-IP header when no keyFn", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, max: 1 }));
    app.get("/", (c) => c.text("ok"));

    const headersA = { "CF-Connecting-IP": "1.1.1.1" };
    const headersB = { "CF-Connecting-IP": "2.2.2.2" };

    expect((await app.request("/", { headers: headersA })).status).toBe(200);
    expect((await app.request("/", { headers: headersA })).status).toBe(429);
    expect((await app.request("/", { headers: headersB })).status).toBe(200);
  });

  test("falls back to X-Forwarded-For when no CF-Connecting-IP", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, max: 1 }));
    app.get("/", (c) => c.text("ok"));

    const headers = { "X-Forwarded-For": "10.0.0.1" };
    expect((await app.request("/", { headers })).status).toBe(200);
    expect((await app.request("/", { headers })).status).toBe(429);
  });

  test("uses 'unknown' key when no IP headers available", async () => {
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, max: 1 }));
    app.get("/", (c) => c.text("ok"));

    expect((await app.request("/")).status).toBe(200);
    expect((await app.request("/")).status).toBe(429);
  });
});

describe("cors", () => {
  test("handles OPTIONS preflight", async () => {
    const app = new Hono();
    app.use("*", cors);
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  test("adds CORS headers to responses", async () => {
    const app = new Hono();
    app.use("*", cors);
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});

describe("bearerAuth", () => {
  test("rejects missing token", async () => {
    const app = new Hono();
    app.use("*", bearerAuth);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv();
    const res = await app.request("/", {}, env, createTestCtx());
    expect(res.status).toBe(401);
  });

  test("accepts correct token", async () => {
    const app = new Hono();
    app.use("*", bearerAuth);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv();
    const res = await app.request(
      "/",
      { headers: { Authorization: "Bearer test-token" } },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
  });

  test("rejects token with wrong length", async () => {
    const app = new Hono();
    app.use("*", bearerAuth);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv();
    const res = await app.request(
      "/",
      { headers: { Authorization: "Bearer short" } },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(401);
  });
});
