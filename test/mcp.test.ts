import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Bindings } from "../src/bindings";
import { mcpRoute } from "../src/mcp/server";
import { authHeader, createTestCtx, createTestEnv } from "./helpers/test-app";

function buildApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.route("/mcp", mcpRoute);
  return app;
}

async function rpc(
  app: ReturnType<typeof buildApp>,
  env: Bindings,
  body: unknown,
): Promise<{ status: number; data: any }> {
  const res = await app.request(
    "https://test.example/mcp",
    {
      method: "POST",
      headers: { ...authHeader(), "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    env,
    createTestCtx(),
  );
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

describe("MCP authentication", () => {
  test("rejects missing token", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      { method: "POST", body: "{}" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(401);
  });
});

describe("MCP initialize", () => {
  test("returns server info and capabilities", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { status, data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {} },
    });
    expect(status).toBe(200);
    expect(data.jsonrpc).toBe("2.0");
    expect(data.id).toBe(1);
    expect(data.result.serverInfo.name).toBe("open-shortlink");
    expect(data.result.capabilities.tools).toBeDefined();
  });
});

describe("MCP tools/list", () => {
  test("returns all 7 tools", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(data.result.tools).toHaveLength(7);
    const names = data.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual([
      "create_link",
      "delete_link",
      "get_ai_stats",
      "get_analytics",
      "get_link",
      "get_top_links",
      "list_links",
    ]);
  });
});

describe("MCP tools/call", () => {
  let app: ReturnType<typeof buildApp>;
  let env: Bindings;

  beforeEach(() => {
    app = buildApp();
    env = createTestEnv();
  });

  test("create_link creates a short link", async () => {
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "abc" },
      },
    });
    expect(data.result.isError).toBeUndefined();
    const content = JSON.parse(data.result.content[0].text);
    expect(content.slug).toBe("abc");
    expect(content.url).toBe("https://example.com");
  });

  test("create_link returns isError for invalid URL", async () => {
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "create_link", arguments: { url: "not a url" } },
    });
    expect(data.result.isError).toBe(true);
  });

  test("get_link returns link details", async () => {
    await rpc(app, env, {
      jsonrpc: "2.0",
      id: 5,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "xyz" },
      },
    });
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 6,
      method: "tools/call",
      params: { name: "get_link", arguments: { slug: "xyz" } },
    });
    const content = JSON.parse(data.result.content[0].text);
    expect(content.slug).toBe("xyz");
  });

  test("get_link returns isError for missing slug", async () => {
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 7,
      method: "tools/call",
      params: { name: "get_link", arguments: { slug: "missing" } },
    });
    expect(data.result.isError).toBe(true);
  });

  test("delete_link removes a link", async () => {
    await rpc(app, env, {
      jsonrpc: "2.0",
      id: 8,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "todel" },
      },
    });
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 9,
      method: "tools/call",
      params: { name: "delete_link", arguments: { slug: "todel" } },
    });
    expect(data.result.isError).toBeUndefined();
  });

  test("list_links returns created links", async () => {
    await rpc(app, env, {
      jsonrpc: "2.0",
      id: 100,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "l1" },
      },
    });
    await rpc(app, env, {
      jsonrpc: "2.0",
      id: 101,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.org", slug: "l2" },
      },
    });
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 102,
      method: "tools/call",
      params: { name: "list_links", arguments: { limit: 10 } },
    });
    const content = JSON.parse(data.result.content[0].text);
    expect(content.links.length).toBe(2);
  });

  test("list_links works with empty arguments", async () => {
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 103,
      method: "tools/call",
      params: { name: "list_links", arguments: {} },
    });
    const content = JSON.parse(data.result.content[0].text);
    expect(content.links).toEqual([]);
  });

  test("create_link returns isError for duplicate slug", async () => {
    await rpc(app, env, {
      jsonrpc: "2.0",
      id: 104,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://a.com", slug: "dup" },
      },
    });
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 105,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://b.com", slug: "dup" },
      },
    });
    expect(data.result.isError).toBe(true);
  });

  test("delete_link returns isError for missing slug", async () => {
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 106,
      method: "tools/call",
      params: { name: "delete_link", arguments: { slug: "missing" } },
    });
    expect(data.result.isError).toBe(true);
  });

  test("unknown tool returns error", async () => {
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 10,
      method: "tools/call",
      params: { name: "nonexistent", arguments: {} },
    });
    expect(data.error).toBeDefined();
    expect(data.error.code).toBe(-32601);
  });

  test("analytics tool without credentials returns isError", async () => {
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 11,
      method: "tools/call",
      params: {
        name: "get_analytics",
        arguments: { slug: "abc", period: "7d" },
      },
    });
    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain(
      "Analytics query is not configured",
    );
  });
});

describe("MCP notifications", () => {
  test("notifications/initialized returns 204", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(204);
  });
});

describe("MCP tools/call edge cases", () => {
  test("tools/call with missing name returns -32602", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 20,
      method: "tools/call",
      params: { arguments: {} },
    });
    expect(data.error.code).toBe(-32602);
    expect(data.error.message).toContain("missing tool name");
  });

  test("tools/call with missing params returns -32602", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 21,
      method: "tools/call",
    });
    expect(data.error.code).toBe(-32602);
  });

  test("ping returns empty result", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 22,
      method: "ping",
    });
    expect(data.result).toEqual({});
  });

  test("notification for unknown method returns 204", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "unknown/notif" }),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(204);
  });

  test("batch of only notifications returns 204", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: JSON.stringify([
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", method: "notifications/cancelled" },
        ]),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(204);
  });
});

describe("MCP JSON-RPC edge cases", () => {
  test("returns parse error for invalid JSON", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: { ...authHeader(), "content-type": "application/json" },
        body: "{ invalid",
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { error: { code: number } };
    expect(data.error.code).toBe(-32700);
  });

  test("unknown method returns -32601", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 99,
      method: "unknown/method",
    });
    expect(data.error.code).toBe(-32601);
  });

  test("batch request returns array", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, [
      { jsonrpc: "2.0", id: 1, method: "tools/list" },
      { jsonrpc: "2.0", id: 2, method: "ping" },
    ]);
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(2);
  });
});

describe("MCP GET /mcp", () => {
  test("returns server info on GET", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      { method: "GET", headers: authHeader() },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { name: string };
    expect(data.name).toBe("open-shortlink");
  });
});
