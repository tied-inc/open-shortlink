import { Hono } from "hono";
import type { Bindings } from "../bindings";
import { tools, toolMap, type ToolContext } from "./tools";

// Minimal JSON-RPC 2.0 + MCP handler suited to stateless Workers.
// Supports the initialize / tools/list / tools/call methods used by MCP clients.

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

const PROTOCOL_VERSION = "2025-06-18";
const SERVER_INFO = { name: "open-shortlink", version: "0.1.0" };

export const mcpRoute = new Hono<{ Bindings: Bindings }>();

mcpRoute.use("*", async (c, next) => {
  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!c.env.API_TOKEN || token !== c.env.API_TOKEN) {
    return c.json({ error: "unauthorized" }, 401);
  }
  return next();
});

mcpRoute.post("/", async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | JsonRpcRequest
    | JsonRpcRequest[]
    | null;
  if (!body) {
    return c.json(rpcError(null, -32700, "parse error"));
  }

  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const ctx: ToolContext = { env: c.env, baseUrl };

  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((req) => handleRpc(req, ctx)),
    );
    const nonNotifications = responses.filter((r): r is JsonRpcResponse => r !== null);
    if (nonNotifications.length === 0) return c.body(null, 204);
    return c.json(nonNotifications);
  }

  const response = await handleRpc(body, ctx);
  if (response === null) return c.body(null, 204);
  return c.json(response);
});

// Some MCP clients probe with GET. Respond with server info.
mcpRoute.get("/", (c) => {
  return c.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocolVersion: PROTOCOL_VERSION,
  });
});

async function handleRpc(
  req: JsonRpcRequest,
  ctx: ToolContext,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case "initialize":
        return rpcResult(id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: SERVER_INFO,
        });

      case "notifications/initialized":
      case "notifications/cancelled":
        return null;

      case "ping":
        return rpcResult(id, {});

      case "tools/list":
        return rpcResult(id, {
          tools: tools.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.inputSchema,
          })),
        });

      case "tools/call": {
        const params = req.params ?? {};
        const name = params["name"] as string | undefined;
        const args = (params["arguments"] as Record<string, unknown>) ?? {};
        if (!name) {
          return rpcError(id, -32602, "missing tool name");
        }
        const tool = toolMap.get(name);
        if (!tool) {
          return rpcError(id, -32601, `unknown tool: ${name}`);
        }
        try {
          const result = await tool.handler(args, ctx);
          return rpcResult(id, {
            content: [
              { type: "text", text: JSON.stringify(result, null, 2) },
            ],
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return rpcResult(id, {
            isError: true,
            content: [{ type: "text", text: message }],
          });
        }
      }

      default:
        if (isNotification) return null;
        return rpcError(id, -32601, `method not found: ${req.method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (isNotification) return null;
    return rpcError(id, -32603, message);
  }
}

function rpcResult(
  id: string | number | null,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

function rpcError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data } };
}
