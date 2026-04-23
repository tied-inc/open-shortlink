import { Hono } from "hono";
import type { Bindings } from "../bindings";
import { bearerAuth } from "../middleware/auth";
import { tools, toolMap, type ToolContext } from "./tools";

// Minimal JSON-RPC 2.0 + MCP handler suited to stateless Workers.
// Implements the Streamable HTTP transport subset required by real MCP
// clients (Claude Desktop, mcp-inspector, Cursor).

interface JsonRpcRequest {
  jsonrpc?: "2.0";
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
const SUPPORTED_PROTOCOL_VERSIONS = [
  "2025-06-18",
  "2025-03-26",
  "2024-11-05",
];
const SERVER_INFO = { name: "open-shortlink", version: "0.1.0" };

export const mcpRoute = new Hono<{ Bindings: Bindings }>();

mcpRoute.use("*", bearerAuth);

mcpRoute.post("/", async (c) => {
  // Spec: client MUST send Accept listing both application/json and
  // text/event-stream. Be lenient for curl/other tools by allowing */* or
  // a missing header, but reject a header that excludes both explicitly.
  const accept = c.req.header("accept") ?? "";
  if (!acceptsJsonResponse(accept)) {
    return c.json(
      rpcError(null, -32600, "client must accept application/json"),
      406,
    );
  }

  const body = (await c.req.json().catch(() => null)) as
    | JsonRpcRequest
    | JsonRpcRequest[]
    | null;
  if (!body) {
    return c.json(rpcError(null, -32700, "parse error"), 400);
  }

  const url = new URL(c.req.url);
  const baseUrl = `${url.protocol}//${url.host}`;
  const ctx: ToolContext = { env: c.env, baseUrl };

  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((req) => handleRpc(req, ctx)),
    );
    const nonNotifications = responses.filter((r): r is JsonRpcResponse => r !== null);
    // Spec: responses/notifications only => 202 Accepted with empty body.
    if (nonNotifications.length === 0) return c.body(null, 202);
    return c.json(nonNotifications);
  }

  const response = await handleRpc(body, ctx);
  if (response === null) return c.body(null, 202);
  return c.json(response);
});

// Spec: GET is used by clients to open an SSE stream. We don't stream, so
// clients requesting text/event-stream MUST get 405. Plain GET (curl, health
// checks) still gets a JSON server info summary.
mcpRoute.get("/", (c) => {
  const accept = c.req.header("accept") ?? "";
  if (accept.includes("text/event-stream")) {
    return c.body(null, 405);
  }
  return c.json({
    name: SERVER_INFO.name,
    version: SERVER_INFO.version,
    protocolVersion: PROTOCOL_VERSION,
  });
});

// Spec: DELETE is used for explicit session termination. We're stateless,
// so respond 405 Method Not Allowed.
mcpRoute.delete("/", (c) => {
  return c.body(null, 405);
});

function acceptsJsonResponse(accept: string): boolean {
  if (!accept) return true;
  const lower = accept.toLowerCase();
  return (
    lower.includes("application/json") ||
    lower.includes("application/*") ||
    lower.includes("*/*")
  );
}

function negotiateProtocolVersion(requested: unknown): string {
  if (typeof requested === "string" && SUPPORTED_PROTOCOL_VERSIONS.includes(requested)) {
    return requested;
  }
  return PROTOCOL_VERSION;
}

async function handleRpc(
  req: JsonRpcRequest,
  ctx: ToolContext,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;

  try {
    switch (req.method) {
      case "initialize": {
        const clientVersion = req.params?.["protocolVersion"];
        return rpcResult(id, {
          protocolVersion: negotiateProtocolVersion(clientVersion),
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
        });
      }

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
            structuredContent: result,
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
    if (isNotification) return null;
    const message = err instanceof Error ? err.message : String(err);
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
