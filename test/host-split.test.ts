import { describe, expect, test } from "bun:test";
import {
  hostSplitDecision,
  isApiOrMcpPath,
} from "../src/middleware/host-split";

// Pure-function tests for the host-split decision logic. The Hono-level
// middleware is exercised indirectly by app.test.ts and api-handler.test.ts;
// this file covers the helper used at the outer Worker entry (src/index.ts)
// to gate paths OAuthProvider services itself before any Hono code runs.

const HOSTS = {
  REDIRECT_HOST: "go.example.com",
  API_HOST: "api.example.com",
};

function decide(urlString: string) {
  return hostSplitDecision(new URL(urlString), HOSTS);
}

describe("isApiOrMcpPath", () => {
  test("classifies API and MCP surfaces", () => {
    expect(isApiOrMcpPath("/api")).toBe(true);
    expect(isApiOrMcpPath("/api/links")).toBe(true);
    expect(isApiOrMcpPath("/mcp")).toBe(true);
    expect(isApiOrMcpPath("/mcp/anything")).toBe(true);
  });

  test("classifies OAuth-related endpoints as API-side", () => {
    expect(isApiOrMcpPath("/authorize")).toBe(true);
    expect(isApiOrMcpPath("/oauth/callback")).toBe(true);
    expect(isApiOrMcpPath("/token")).toBe(true);
    expect(isApiOrMcpPath("/register")).toBe(true);
    expect(isApiOrMcpPath("/.well-known/oauth-authorization-server")).toBe(
      true,
    );
    expect(isApiOrMcpPath("/.well-known/oauth-protected-resource")).toBe(true);
  });

  test("classifies redirect / health / static paths as redirect-side", () => {
    expect(isApiOrMcpPath("/")).toBe(false);
    expect(isApiOrMcpPath("/health")).toBe(false);
    expect(isApiOrMcpPath("/abc123")).toBe(false);
    expect(isApiOrMcpPath("/robots.txt")).toBe(false);
    expect(isApiOrMcpPath("/favicon.ico")).toBe(false);
  });
});

describe("hostSplitDecision", () => {
  test("allows everything when no host split is configured", () => {
    const url = new URL("https://anything.example/api/links");
    expect(hostSplitDecision(url, {})).toBe("allow");
  });

  test("blocks API paths on the redirect host", () => {
    expect(decide("https://go.example.com/api/links")).toBe("deny");
    expect(decide("https://go.example.com/mcp")).toBe("deny");
    expect(decide("https://go.example.com/mcp/initialize")).toBe("deny");
  });

  test("blocks OAuthProvider's own endpoints on the redirect host", () => {
    // Regression: these are served by OAuthProvider directly and bypassed
    // the Hono middleware before this fix was added.
    expect(decide("https://go.example.com/token")).toBe("deny");
    expect(decide("https://go.example.com/register")).toBe("deny");
    expect(
      decide(
        "https://go.example.com/.well-known/oauth-authorization-server",
      ),
    ).toBe("deny");
    expect(
      decide("https://go.example.com/.well-known/oauth-protected-resource"),
    ).toBe("deny");
  });

  test("allows redirect paths on the redirect host", () => {
    expect(decide("https://go.example.com/abc123")).toBe("allow");
    expect(decide("https://go.example.com/robots.txt")).toBe("allow");
    expect(decide("https://go.example.com/favicon.ico")).toBe("allow");
  });

  test("blocks redirect paths on the API host", () => {
    expect(decide("https://api.example.com/abc123")).toBe("deny");
  });

  test("allows API and OAuth paths on the API host", () => {
    expect(decide("https://api.example.com/api/links")).toBe("allow");
    expect(decide("https://api.example.com/mcp")).toBe("allow");
    expect(decide("https://api.example.com/authorize")).toBe("allow");
    expect(decide("https://api.example.com/oauth/callback")).toBe("allow");
    expect(decide("https://api.example.com/token")).toBe("allow");
    expect(decide("https://api.example.com/register")).toBe("allow");
    expect(
      decide(
        "https://api.example.com/.well-known/oauth-authorization-server",
      ),
    ).toBe("allow");
  });

  test("allows / and /health on the API host (uptime / smoke checks)", () => {
    expect(decide("https://api.example.com/")).toBe("allow");
    expect(decide("https://api.example.com/health")).toBe("allow");
  });
});
