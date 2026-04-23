import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Bindings } from "../src/bindings";
import { mcpRoute } from "../src/mcp/server";
import { apiRoute } from "../src/routes/api";
import { authHeader, createTestCtx, createTestEnv } from "./helpers/test-app";

const originalFetch = globalThis.fetch;
let queue: unknown[][] = [];

function stubFetch() {
  globalThis.fetch = (async () => {
    const data = queue.shift() ?? [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
}

function queueResponses(...responses: unknown[][]) {
  queue.push(...responses);
}

function buildApiApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.route("/api", apiRoute);
  return app;
}

function buildMcpApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.route("/mcp", mcpRoute);
  return app;
}

async function apiGet(path: string, env: Bindings) {
  const app = buildApiApp();
  return app.request(
    `https://test.example${path}`,
    { method: "GET", headers: authHeader() },
    env,
    createTestCtx(),
  );
}

async function mcpCall(env: Bindings, name: string, args: unknown) {
  const app = buildMcpApp();
  const res = await app.request(
    "https://test.example/mcp",
    {
      method: "POST",
      headers: { ...authHeader(), "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: { name, arguments: args },
      }),
    },
    env,
    createTestCtx(),
  );
  return (await res.json()) as any;
}

beforeEach(() => {
  queue = [];
  stubFetch();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("GET /api/analytics/:slug", () => {
  test("returns slug analytics when configured", async () => {
    queueResponses(
      [{ total: 100, ai: 10, countries: 3 }],
      [{ referer: "https://a.com", clicks: 50 }],
      [{ country: "JP", clicks: 60 }],
    );
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet("/api/analytics/abc?period=30d", env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      slug: string;
      totalClicks: number;
      period: string;
    };
    expect(body.slug).toBe("abc");
    expect(body.totalClicks).toBe(100);
    expect(body.period).toBe("30d");
  });

  test("defaults to 7d period when not specified", async () => {
    queueResponses([{ total: 0, ai: 0, countries: 0 }], [], []);
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet("/api/analytics/abc", env);
    const body = (await res.json()) as { period: string };
    expect(body.period).toBe("7d");
  });

  test("falls back to 7d for invalid period", async () => {
    queueResponses([{ total: 0, ai: 0, countries: 0 }], [], []);
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet("/api/analytics/abc?period=bogus", env);
    const body = (await res.json()) as { period: string };
    expect(body.period).toBe("7d");
  });
});

describe("GET /api/analytics/:slug/timeseries", () => {
  test("returns timeseries data", async () => {
    queueResponses([
      { bucket: "2025-01-01T00:00:00Z", clicks: 10, ai: 1 },
      { bucket: "2025-01-02T00:00:00Z", clicks: 20, ai: 2 },
    ]);
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet(
      "/api/analytics/abc/timeseries?period=7d&interval=1d",
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      interval: string;
      data: unknown[];
    };
    expect(body.interval).toBe("1d");
    expect(body.data).toHaveLength(2);
  });

  test("accepts 1h interval", async () => {
    queueResponses([]);
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet(
      "/api/analytics/abc/timeseries?interval=1h",
      env,
    );
    const body = (await res.json()) as { interval: string };
    expect(body.interval).toBe("1h");
  });

  test("falls back to 1d for invalid interval", async () => {
    queueResponses([]);
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet(
      "/api/analytics/abc/timeseries?interval=bogus",
      env,
    );
    const body = (await res.json()) as { interval: string };
    expect(body.interval).toBe("1d");
  });
});

describe("GET /api/analytics/top", () => {
  test("returns top links", async () => {
    queueResponses([
      { slug: "a", clicks: 100 },
      { slug: "b", clicks: 50 },
    ]);
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet("/api/analytics/top?period=7d&limit=5", env);
    const body = (await res.json()) as {
      period: string;
      links: { slug: string }[];
    };
    expect(body.links).toHaveLength(2);
    expect(body.links[0]?.slug).toBe("a");
  });

  test("falls back to default limit for invalid limit", async () => {
    queueResponses([]);
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet("/api/analytics/top?limit=abc", env);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/analytics/ai", () => {
  test("returns AI stats", async () => {
    queueResponses(
      [{ total: 100, ai: 20 }],
      [{ user_agent: "GPTBot/1.0", clicks: 20 }],
    );
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet("/api/analytics/ai?period=30d", env);
    const body = (await res.json()) as {
      totalClicks: number;
      aiClicks: number;
      byBot: { bot: string }[];
    };
    expect(body.totalClicks).toBe(100);
    expect(body.aiClicks).toBe(20);
    expect(body.byBot[0]?.bot).toBe("GPTBot");
  });
});

describe("Analytics routes slug hardening", () => {
  test("rejects invalid slug on /api/analytics/:slug with 400", async () => {
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet(
      "/api/analytics/" + encodeURIComponent("a'; DROP TABLE --"),
      env,
    );
    expect(res.status).toBe(400);
  });

  test("rejects invalid slug on /api/analytics/:slug/timeseries with 400", async () => {
    const env = createTestEnv({ analyticsConfigured: true });
    const res = await apiGet(
      "/api/analytics/" +
        encodeURIComponent("bad slug") +
        "/timeseries",
      env,
    );
    expect(res.status).toBe(400);
  });
});

describe("MCP analytics tools", () => {
  test("get_analytics returns data when configured", async () => {
    queueResponses(
      [{ total: 100, ai: 10, countries: 3 }],
      [{ referer: "https://a.com", clicks: 50 }],
      [{ country: "JP", clicks: 60 }],
    );
    const env = createTestEnv({ analyticsConfigured: true });
    const data = await mcpCall(env, "get_analytics", {
      slug: "abc",
      period: "7d",
    });
    expect(data.result.isError).toBeUndefined();
    const content = JSON.parse(data.result.content[0].text);
    expect(content.slug).toBe("abc");
    expect(content.totalClicks).toBe(100);
  });

  test("get_analytics defaults period when omitted", async () => {
    queueResponses([{ total: 0, ai: 0, countries: 0 }], [], []);
    const env = createTestEnv({ analyticsConfigured: true });
    const data = await mcpCall(env, "get_analytics", { slug: "abc" });
    const content = JSON.parse(data.result.content[0].text);
    expect(content.period).toBe("7d");
  });

  test("get_top_links returns ranking", async () => {
    queueResponses([
      { slug: "a", clicks: 100 },
      { slug: "b", clicks: 50 },
    ]);
    const env = createTestEnv({ analyticsConfigured: true });
    const data = await mcpCall(env, "get_top_links", {
      period: "30d",
      limit: 5,
    });
    const content = JSON.parse(data.result.content[0].text);
    expect(content.links).toHaveLength(2);
    expect(content.period).toBe("30d");
  });

  test("get_top_links uses default period when omitted", async () => {
    queueResponses([]);
    const env = createTestEnv({ analyticsConfigured: true });
    const data = await mcpCall(env, "get_top_links", {});
    const content = JSON.parse(data.result.content[0].text);
    expect(content.period).toBe("7d");
  });

  test("get_ai_stats returns AI breakdown", async () => {
    queueResponses(
      [{ total: 100, ai: 20 }],
      [{ user_agent: "ClaudeBot", clicks: 20 }],
    );
    const env = createTestEnv({ analyticsConfigured: true });
    const data = await mcpCall(env, "get_ai_stats", { period: "7d" });
    const content = JSON.parse(data.result.content[0].text);
    expect(content.aiClicks).toBe(20);
  });

  test("get_ai_stats uses default period when omitted", async () => {
    queueResponses([{ total: 0, ai: 0 }], []);
    const env = createTestEnv({ analyticsConfigured: true });
    const data = await mcpCall(env, "get_ai_stats", {});
    const content = JSON.parse(data.result.content[0].text);
    expect(content.period).toBe("7d");
  });
});
