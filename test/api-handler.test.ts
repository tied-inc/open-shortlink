import { describe, expect, test } from "bun:test";
import { buildAuthenticatedApp } from "../src/api-handler";
import { createTestCtx, createTestEnv } from "./helpers/test-app";

// These tests cover middleware that was lost when /api/* moved from the
// defaultHandler to OAuthProvider's apiHandler. They exercise the
// authenticated Hono app directly (skipping the OAuthProvider token check)
// to confirm CORS, rate-limit, security headers, and host-split are still
// applied on the protected surfaces.

describe("authenticated apiHandler middleware", () => {
  test("applies CORS headers on /api/* responses", async () => {
    const app = buildAuthenticatedApp();
    const env = createTestEnv();
    env.CORS_ALLOW_ORIGIN = "https://ui.example.com";
    const res = await app.request(
      "https://test.example/api/links",
      { method: "GET", headers: { origin: "https://ui.example.com" } },
      env,
      createTestCtx(),
    );
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
      "https://ui.example.com",
    );
  });

  test("answers OPTIONS preflight on /api/* without an access token", async () => {
    const app = buildAuthenticatedApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/api/links",
      { method: "OPTIONS" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
    expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
  });

  test("emits rate-limit headers on /api/*", async () => {
    const app = buildAuthenticatedApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/api/links",
      { method: "GET", headers: { "CF-Connecting-IP": "203.0.113.1" } },
      env,
      createTestCtx(),
    );
    expect(res.headers.get("X-RateLimit-Limit")).toBe("120");
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("119");
  });

  test("emits rate-limit headers on /mcp", async () => {
    const app = buildAuthenticatedApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      { method: "GET", headers: { "CF-Connecting-IP": "203.0.113.2" } },
      env,
      createTestCtx(),
    );
    expect(res.headers.get("X-RateLimit-Limit")).toBe("120");
  });

  test("/api and /mcp rate-limit buckets are independent", async () => {
    // Hammering /mcp must not eat the /api budget for the same IP.
    const app = buildAuthenticatedApp();
    const env = createTestEnv();
    const ip = "203.0.113.3";
    for (let i = 0; i < 5; i++) {
      await app.request(
        "https://test.example/mcp",
        { method: "GET", headers: { "CF-Connecting-IP": ip } },
        env,
        createTestCtx(),
      );
    }
    const res = await app.request(
      "https://test.example/api/links",
      { method: "GET", headers: { "CF-Connecting-IP": ip } },
      env,
      createTestCtx(),
    );
    // /api still on its first request for this IP.
    expect(res.headers.get("X-RateLimit-Remaining")).toBe("119");
  });

  test("applies security headers on /api/*", async () => {
    const app = buildAuthenticatedApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/api/links",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Frame-Options")).toBe("DENY");
  });

  test("host split: /api on REDIRECT_HOST returns 404", async () => {
    const app = buildAuthenticatedApp();
    const env = createTestEnv({
      redirectHost: "go.example.com",
      apiHost: "api.example.com",
    });
    const res = await app.request(
      "https://go.example.com/api/links",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(404);
  });

  test("host split: /mcp on REDIRECT_HOST returns 404", async () => {
    const app = buildAuthenticatedApp();
    const env = createTestEnv({
      redirectHost: "go.example.com",
      apiHost: "api.example.com",
    });
    const res = await app.request(
      "https://go.example.com/mcp",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(404);
  });

  test("host split: /api on API_HOST is allowed through", async () => {
    const app = buildAuthenticatedApp();
    const env = createTestEnv({
      redirectHost: "go.example.com",
      apiHost: "api.example.com",
    });
    const res = await app.request(
      "https://api.example.com/api/links",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
  });
});
