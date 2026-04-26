import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import type { Bindings } from "../src/bindings";
import { mcpHandlers } from "../src/mcp/server";
import { createTestCtx, createTestEnv } from "./helpers/test-app";

// Auth is enforced by OAuthProvider at the /mcp apiRoute boundary in
// src/index.ts. Tests here exercise the Hono handler directly so they
// bypass that layer — every request is treated as already authenticated.
const JSON_HEADERS = { "content-type": "application/json" };

function buildApp() {
  const app = new Hono<{ Bindings: Bindings }>();
  app.route("/mcp", mcpHandlers);
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
      headers: JSON_HEADERS,
      body: JSON.stringify(body),
    },
    env,
    createTestCtx(),
  );
  const data = res.status === 204 ? null : await res.json();
  return { status: res.status, data };
}

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
  test("returns all 8 tools", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    });
    expect(data.result.tools).toHaveLength(8);
    const names = data.result.tools.map((t: any) => t.name).sort();
    expect(names).toEqual([
      "create_link",
      "delete_link",
      "get_ai_stats",
      "get_analytics",
      "get_link",
      "get_timeseries",
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
  test("notifications/initialized returns 202", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        }),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(202);
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

  test("notification for unknown method returns 202", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ jsonrpc: "2.0", method: "unknown/notif" }),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(202);
  });

  test("batch of only notifications returns 202", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify([
          { jsonrpc: "2.0", method: "notifications/initialized" },
          { jsonrpc: "2.0", method: "notifications/cancelled" },
        ]),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(202);
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
        headers: JSON_HEADERS,
        body: "{ invalid",
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(400);
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
      { method: "GET" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { name: string };
    expect(data.name).toBe("open-shortlink");
  });

  test("returns 405 when client requests SSE", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "GET",
        headers: { accept: "text/event-stream" },
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(405);
  });
});

describe("MCP DELETE /mcp", () => {
  test("returns 405 (stateless server does not support session termination)", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      { method: "DELETE" },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(405);
  });
});

describe("MCP streamable-http compat", () => {
  test("accepts application/json + text/event-stream Accept header", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as { result: unknown };
    expect(data.result).toEqual({});
  });

  test("returns 406 when Accept excludes JSON", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "text/html",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(406);
  });

  test("initialize echoes back client protocolVersion when supported", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-03-26", capabilities: {} },
    });
    expect(data.result.protocolVersion).toBe("2025-03-26");
  });

  test("initialize falls back to latest when client version is unknown", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "1999-01-01", capabilities: {} },
    });
    expect(data.result.protocolVersion).toBe("2025-06-18");
  });

  test("tools/call result includes structuredContent for MCP SDK clients", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "sc" },
      },
    });
    expect(data.result.structuredContent).toBeDefined();
    expect(data.result.structuredContent.slug).toBe("sc");
    expect(data.result.structuredContent.url).toBe("https://example.com");
  });

  test("tools/call keeps text content alongside structuredContent for backwards compat", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "bc" },
      },
    });
    expect(Array.isArray(data.result.content)).toBe(true);
    expect(data.result.content[0].type).toBe("text");
    const parsed = JSON.parse(data.result.content[0].text);
    expect(parsed).toEqual(data.result.structuredContent);
  });

  test("tools/list advertises outputSchema for every tool", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/list",
    });
    for (const tool of data.result.tools) {
      expect(tool.outputSchema).toBeDefined();
      expect(tool.outputSchema.type).toBe("object");
    }
  });

  test("create_link structuredContent matches its outputSchema shape", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "os" },
      },
    });
    const sc = data.result.structuredContent;
    expect(typeof sc.slug).toBe("string");
    expect(typeof sc.url).toBe("string");
    expect(typeof sc.shortUrl).toBe("string");
    expect(typeof sc.createdAt).toBe("number");
  });

  test("list_links structuredContent matches its outputSchema shape", async () => {
    const app = buildApp();
    const env = createTestEnv();
    await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "ls1" },
      },
    });
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_links", arguments: {} },
    });
    const sc = data.result.structuredContent;
    expect(Array.isArray(sc.links)).toBe(true);
    expect(sc.links[0].slug).toBe("ls1");
    expect(sc.links[0].shortUrl).toContain("ls1");
  });

  test("delete_link structuredContent returns deleted slug", async () => {
    const app = buildApp();
    const env = createTestEnv();
    await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "https://example.com", slug: "dl" },
      },
    });
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "delete_link", arguments: { slug: "dl" } },
    });
    expect(data.result.structuredContent).toEqual({ deleted: "dl" });
  });
});

describe("MCP hardening", () => {
  test("rejects oversized POST body with 413", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const big = "x".repeat(256 * 1024 + 10);
    const res = await app.request(
      "https://test.example/mcp",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(big.length),
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", big }),
      },
      env,
      createTestCtx(),
    );
    expect(res.status).toBe(413);
  });

  test("create_link blocks SSRF target (localhost)", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: { url: "http://127.0.0.1/admin", slug: "ssrf" },
      },
    });
    expect(data.result.isError).toBe(true);
    expect(data.result.content[0].text).toContain("invalid url");
  });

  test("create_link blocks SSRF target (metadata IP)", async () => {
    const app = buildApp();
    const env = createTestEnv();
    const { data } = await rpc(app, env, {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "create_link",
        arguments: {
          url: "http://169.254.169.254/latest/meta-data/",
          slug: "imd",
        },
      },
    });
    expect(data.result.isError).toBe(true);
  });
});
