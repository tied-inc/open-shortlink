import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { rateLimit } from "../src/middleware/rate-limit";
import { cors } from "../src/middleware/cors";
import { bearerAuth } from "../src/middleware/auth";
import { securityHeaders } from "../src/middleware/security-headers";
import { TEST_TOKEN, createTestCtx, createTestEnv } from "./helpers/test-app";

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

    const retryAfter = Number(res.headers.get("Retry-After"));
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(60);

    expect(res.headers.get("X-RateLimit-Limit")).toBe("2");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("0");
    const reset = Number(res.headers.get("X-RateLimit-Reset"));
    expect(Number.isFinite(reset)).toBe(true);
    expect(reset).toBeGreaterThan(Math.floor(Date.now() / 1000));

    const body = (await res.json()) as { error: string; retryAfter: number };
    expect(body.error).toBe("rate limit exceeded");
    expect(body.retryAfter).toBe(retryAfter);
  });

  test("decrements X-RateLimit-Remaining on each request", async () => {
    const app = new Hono();
    app.use(
      "*",
      rateLimit({ windowMs: 60_000, max: 3, keyFn: () => "fixed" }),
    );
    app.get("/", (c) => c.text("ok"));

    const r1 = await app.request("/");
    expect(r1.headers.get("X-RateLimit-Remaining")).toBe("2");
    const r2 = await app.request("/");
    expect(r2.headers.get("X-RateLimit-Remaining")).toBe("1");
    const r3 = await app.request("/");
    expect(r3.headers.get("X-RateLimit-Remaining")).toBe("0");
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

  test("ignores X-Forwarded-For (spoofable header)", async () => {
    // An attacker who rotates X-Forwarded-For must NOT bypass the limit.
    // With no CF-Connecting-IP the middleware collapses every request to the
    // same fallback key.
    const app = new Hono();
    app.use("*", rateLimit({ windowMs: 60_000, max: 1 }));
    app.get("/", (c) => c.text("ok"));

    expect(
      (await app.request("/", { headers: { "X-Forwarded-For": "1.1.1.1" } }))
        .status,
    ).toBe(200);
    expect(
      (await app.request("/", { headers: { "X-Forwarded-For": "2.2.2.2" } }))
        .status,
    ).toBe(429);
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
  test("handles OPTIONS preflight without Origin defaults to *", async () => {
    const app = new Hono();
    app.use("*", cors);
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/", { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  test("adds CORS headers to responses when allowlist unset", async () => {
    const app = new Hono();
    app.use("*", cors);
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });

  test("echoes Origin when allowlist matches", async () => {
    const app = new Hono();
    app.use("*", cors);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv();
    env.CORS_ALLOW_ORIGIN = "https://ui.example.com,https://admin.example.com";
    const res = await app.request(
      "/",
      { headers: { origin: "https://ui.example.com" } },
      env,
      createTestCtx(),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://ui.example.com",
    );
    expect(res.headers.get("Vary")).toBe("Origin");
  });

  test("omits ACAO when Origin not in allowlist", async () => {
    const app = new Hono();
    app.use("*", cors);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv();
    env.CORS_ALLOW_ORIGIN = "https://ui.example.com";
    const res = await app.request(
      "/",
      { headers: { origin: "https://evil.example" } },
      env,
      createTestCtx(),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBeNull();
  });

  test("preflight from unknown origin returns 403", async () => {
    const app = new Hono();
    app.use("*", cors);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv();
    env.CORS_ALLOW_ORIGIN = "https://ui.example.com";
    const res = await app.request(
      "/",
      { method: "OPTIONS", headers: { origin: "https://evil.example" } },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(403);
  });
});

describe("securityHeaders", () => {
  test("sets baseline hardening headers", async () => {
    const app = new Hono();
    app.use("*", securityHeaders);
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
    expect(res.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(res.headers.get("Strict-Transport-Security")).toContain("max-age=");
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
    expect(res.headers.get("WWW-Authenticate")).toContain("Bearer");
  });

  test("accepts correct token", async () => {
    const app = new Hono();
    app.use("*", bearerAuth);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv();
    const res = await app.request(
      "/",
      { headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
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

  test("returns 503 when API_TOKEN is unset", async () => {
    const app = new Hono();
    app.use("*", bearerAuth);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv({ apiToken: "" });
    const res = await app.request(
      "/",
      { headers: { Authorization: `Bearer ${TEST_TOKEN}` } },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(503);
  });

  test("returns 503 when API_TOKEN is a well-known placeholder", async () => {
    const app = new Hono();
    app.use("*", bearerAuth);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv({ apiToken: "dev-token-change-me" });
    const res = await app.request(
      "/",
      { headers: { Authorization: `Bearer dev-token-change-me` } },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(503);
  });

  test("returns 503 when API_TOKEN is shorter than 24 chars", async () => {
    const app = new Hono();
    app.use("*", bearerAuth);
    app.get("/", (c) => c.text("ok"));

    const env = createTestEnv({ apiToken: "short-token-abc" });
    const res = await app.request(
      "/",
      { headers: { Authorization: "Bearer short-token-abc" } },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(503);
  });
});
