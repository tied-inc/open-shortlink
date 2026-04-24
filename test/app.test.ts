import { beforeEach, describe, expect, test } from "bun:test";
import app from "../src/app";
import type { Bindings } from "../src/bindings";
import { LinkStore } from "../src/storage/kv";
import { createTestCtx, createTestEnv } from "./helpers/test-app";

describe("Reserved conventional paths", () => {
  let env: Bindings;

  beforeEach(() => {
    env = createTestEnv();
  });

  test("GET /robots.txt returns text/plain disallow", async () => {
    const res = await app.request(
      "https://go.example.com/robots.txt",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    expect(await res.text()).toContain("Disallow");
  });

  test("GET /favicon.ico returns 204", async () => {
    const res = await app.request(
      "https://go.example.com/favicon.ico",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(204);
  });

  test("reserved paths beat a same-named slug", async () => {
    // A stored slug like "robots" must not shadow the explicit /robots.txt
    // handler. (The slug itself cannot be "robots.txt" — the dot is invalid —
    // but a slug "robots" plus a request to /robots.txt must resolve to the
    // reserved handler.)
    await new LinkStore(env.SHORTLINKS).put("robots", "https://evil.example");
    const res = await app.request(
      "https://go.example.com/robots.txt",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("Host-based routing", () => {
  test("API host returns 404 for /:slug", async () => {
    const env = createTestEnv({
      redirectHost: "go.example.com",
      apiHost: "api.example.com",
    });
    await new LinkStore(env.SHORTLINKS).put("abc", "https://example.com");
    const res = await app.request(
      "https://api.example.com/abc",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(404);
  });

  test("redirect host returns 404 for /api/*", async () => {
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

  test("redirect host returns 404 for OAuth endpoints", async () => {
    // OAuth endpoints live on the API host; the redirect host must not leak
    // them even though they are served by the same worker.
    const env = createTestEnv({
      redirectHost: "go.example.com",
      apiHost: "api.example.com",
    });
    const res = await app.request(
      "https://go.example.com/authorize",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(404);
  });

  test("redirect host still serves /:slug", async () => {
    const env = createTestEnv({
      redirectHost: "go.example.com",
      apiHost: "api.example.com",
    });
    await new LinkStore(env.SHORTLINKS).put("abc", "https://example.com");
    const res = await app.request(
      "https://go.example.com/abc",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("https://example.com");
  });

  test("API host serves /health", async () => {
    // /health is whitelisted on the API host (for uptime monitors). The
    // /api/* and /mcp/* routes themselves live on OAuthProvider (src/index.ts)
    // and are not reachable through the defaultHandler covered by this test.
    const env = createTestEnv({
      redirectHost: "go.example.com",
      apiHost: "api.example.com",
    });
    const res = await app.request(
      "https://api.example.com/health",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
  });

  test("without host split, redirect paths work on any host", async () => {
    const env = createTestEnv();
    await new LinkStore(env.SHORTLINKS).put("abc", "https://example.com");
    const redirectRes = await app.request(
      "https://anything.example/abc",
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(redirectRes.status).toBe(302);
  });
});
