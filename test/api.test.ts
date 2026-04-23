import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Bindings } from "../src/bindings";
import { apiRoute } from "../src/routes/api";
import { authHeader, createTestCtx, createTestEnv } from "./helpers/test-app";

function buildApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.route("/api", apiRoute);
  return app;
}

async function req(
  app: ReturnType<typeof buildApp>,
  path: string,
  init: RequestInit,
  env: Bindings,
) {
  return app.request(
    `https://test.example${path}`,
    init,
    env,
    createTestCtx(),
  );
}

describe("API authentication", () => {
  const app = buildApp();
  const env = createTestEnv();

  test("rejects missing Authorization header", async () => {
    const res = await req(app, "/api/links", { method: "GET" }, env);
    expect(res.status).toBe(401);
  });

  test("rejects wrong token", async () => {
    const res = await req(
      app,
      "/api/links",
      { method: "GET", headers: { Authorization: "Bearer wrong" } },
      env,
    );
    expect(res.status).toBe(401);
  });

  test("accepts correct token", async () => {
    const res = await req(
      app,
      "/api/links",
      { method: "GET", headers: authHeader() },
      env,
    );
    expect(res.status).toBe(200);
  });
});

describe("POST /api/links", () => {
  let app: ReturnType<typeof buildApp>;
  let env: Bindings;

  beforeEach(() => {
    app = buildApp();
    env = createTestEnv();
  });

  test("creates link with auto-generated slug", async () => {
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com" }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slug).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(body.url).toBe("https://example.com");
    expect(body.shortUrl).toContain("test.example/");
  });

  test("creates link with custom slug", async () => {
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", slug: "hello" }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slug).toBe("hello");
  });

  test("returns 400 for invalid URL", async () => {
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "not a url" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for reserved slug", async () => {
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", slug: "api" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("returns 400 for invalid JSON body", async () => {
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: "{ invalid",
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("uses PUBLIC_BASE_URL for shortUrl when configured", async () => {
    const appWithBase = buildApp();
    const envWithBase = createTestEnv({
      publicBaseUrl: "https://go.example.com",
    });
    const res = await req(
      appWithBase,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", slug: "abc" }),
      },
      envWithBase,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.shortUrl).toBe("https://go.example.com/abc");
  });

  test("rejects target URL pointing at the shortener host", async () => {
    const appWithBase = buildApp();
    const envWithBase = createTestEnv({
      publicBaseUrl: "https://go.example.com",
    });
    const res = await req(
      appWithBase,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://go.example.com/evil" }),
      },
      envWithBase,
    );
    expect(res.status).toBe(400);
  });

  test("creates link with geo variants", async () => {
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          slug: "geo1",
          geo: {
            US: "https://example.com/en",
            JP: "https://example.com/ja",
          },
        }),
      },
      env,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slug).toBe("geo1");
    expect(body.geo).toEqual({
      US: "https://example.com/en",
      JP: "https://example.com/ja",
    });
  });

  test("rejects invalid country code in geo", async () => {
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          geo: { USA: "https://example.com/en" },
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("rejects invalid url in geo", async () => {
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({
          url: "https://example.com",
          geo: { US: "not-a-url" },
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("returns 409 for duplicate slug", async () => {
    await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://a.com", slug: "dup" }),
      },
      env,
    );
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://b.com", slug: "dup" }),
      },
      env,
    );
    expect(res.status).toBe(409);
  });
});

describe("GET /api/links/:slug", () => {
  let app: ReturnType<typeof buildApp>;
  let env: Bindings;

  beforeEach(() => {
    app = buildApp();
    env = createTestEnv();
  });

  test("returns existing link", async () => {
    await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", slug: "abc" }),
      },
      env,
    );

    const res = await req(
      app,
      "/api/links/abc",
      { method: "GET", headers: authHeader() },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.slug).toBe("abc");
  });

  test("returns 404 for missing slug", async () => {
    const res = await req(
      app,
      "/api/links/missing",
      { method: "GET", headers: authHeader() },
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/links/:slug", () => {
  let app: ReturnType<typeof buildApp>;
  let env: Bindings;

  beforeEach(() => {
    app = buildApp();
    env = createTestEnv();
  });

  test("deletes existing link", async () => {
    await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", slug: "abc" }),
      },
      env,
    );
    const res = await req(
      app,
      "/api/links/abc",
      { method: "DELETE", headers: authHeader() },
      env,
    );
    expect(res.status).toBe(204);

    const getRes = await req(
      app,
      "/api/links/abc",
      { method: "GET", headers: authHeader() },
      env,
    );
    expect(getRes.status).toBe(404);
  });

  test("returns 404 for missing slug", async () => {
    const res = await req(
      app,
      "/api/links/missing",
      { method: "DELETE", headers: authHeader() },
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("GET /api/links (list)", () => {
  test("lists empty when no links", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await req(
      app,
      "/api/links",
      { method: "GET", headers: authHeader() },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { links: unknown[] };
    expect(body.links).toEqual([]);
  });

  test("lists created links", async () => {
    const app = buildApp();
    const env = createTestEnv();
    for (const slug of ["a", "b", "c"]) {
      await req(
        app,
        "/api/links",
        {
          method: "POST",
          headers: { ...authHeader(), "content-type": "application/json" },
          body: JSON.stringify({ url: `https://${slug}.example`, slug }),
        },
        env,
      );
    }
    const res = await req(
      app,
      "/api/links?limit=10",
      { method: "GET", headers: authHeader() },
      env,
    );
    const body = (await res.json()) as { links: { slug: string }[] };
    expect(body.links).toHaveLength(3);
  });
});

describe("Unexpected internal errors", () => {
  function buildAppWithBrokenKV() {
    const app = new Hono<{ Bindings: Bindings }>();
    app.route("/api", apiRoute);
    app.onError((err, c) =>
      c.json({ error: err instanceof Error ? err.message : "err" }, 500),
    );
    return app;
  }

  function brokenEnv(): Bindings {
    const env = createTestEnv();
    // Every KV method throws.
    env.SHORTLINKS = new Proxy({} as KVNamespace, {
      get: () => () => {
        throw new Error("boom");
      },
    });
    return env;
  }

  test("POST /api/links returns 500 on unexpected KV failure", async () => {
    const app = buildAppWithBrokenKV();
    const res = await app.request(
      "https://test.example/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "https://example.com", slug: "abc" }),
      },
      brokenEnv(),
      createTestCtx(),
    );
    expect(res.status).toBe(500);
  });

  test("GET /api/links/:slug returns 500 on unexpected KV failure", async () => {
    const app = buildAppWithBrokenKV();
    const res = await app.request(
      "https://test.example/api/links/anything",
      { method: "GET", headers: authHeader() },
      brokenEnv(),
      createTestCtx(),
    );
    expect(res.status).toBe(500);
  });

  test("DELETE /api/links/:slug returns 500 on unexpected KV failure", async () => {
    const app = buildAppWithBrokenKV();
    const res = await app.request(
      "https://test.example/api/links/anything",
      { method: "DELETE", headers: authHeader() },
      brokenEnv(),
      createTestCtx(),
    );
    expect(res.status).toBe(500);
  });
});

describe("POST /api/links hardening", () => {
  test("blocks SSRF target (localhost)", async () => {
    const app = new Hono<{ Bindings: Bindings }>();
    app.route("/api", apiRoute);
    const env = createTestEnv();
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "http://127.0.0.1/admin" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("blocks metadata IP", async () => {
    const app = new Hono<{ Bindings: Bindings }>();
    app.route("/api", apiRoute);
    const env = createTestEnv();
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ url: "http://169.254.169.254/latest/" }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  test("blocks RFC1918 and internal TLD", async () => {
    const app = new Hono<{ Bindings: Bindings }>();
    app.route("/api", apiRoute);
    const env = createTestEnv();
    for (const url of [
      "http://192.168.1.1",
      "http://10.0.0.1",
      "http://172.16.0.1",
      "http://intranet.local/",
      "http://service.internal/",
    ]) {
      const res = await req(
        app,
        "/api/links",
        {
          method: "POST",
          headers: { ...authHeader(), "content-type": "application/json" },
          body: JSON.stringify({ url }),
        },
        env,
      );
      expect(res.status).toBe(400);
    }
  });

  test("rejects oversized POST body with 413", async () => {
    const app = new Hono<{ Bindings: Bindings }>();
    app.route("/api", apiRoute);
    const env = createTestEnv();
    const body = JSON.stringify({
      url: "https://example.com",
      slug: "abc",
      extra: "x".repeat(20 * 1024),
    });
    const res = await req(
      app,
      "/api/links",
      {
        method: "POST",
        headers: {
          ...authHeader(),
          "content-type": "application/json",
          "content-length": String(body.length),
        },
        body,
      },
      env,
    );
    expect(res.status).toBe(413);
  });

  test("GET /api/links/:slug rejects invalid slug with 400", async () => {
    const app = new Hono<{ Bindings: Bindings }>();
    app.route("/api", apiRoute);
    const env = createTestEnv();
    const res = await req(
      app,
      "/api/links/" + encodeURIComponent("bad slug"),
      { method: "GET", headers: authHeader() },
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("Analytics endpoints without credentials", () => {
  test("return 503 when CF_ACCOUNT_ID / CF_ANALYTICS_TOKEN are missing", async () => {
    const app = buildApp();
    const env = createTestEnv(); // analyticsConfigured: false

    for (const path of [
      "/api/analytics/top",
      "/api/analytics/ai",
      "/api/analytics/abc",
      "/api/analytics/abc/timeseries",
    ]) {
      const res = await req(
        app,
        path,
        { method: "GET", headers: authHeader() },
        env,
      );
      expect(res.status).toBe(503);
    }
  });
});
