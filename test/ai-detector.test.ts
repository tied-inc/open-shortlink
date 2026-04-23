import { describe, expect, test } from "bun:test";
import { detectAiBot, isAiUserAgent } from "../src/analytics/ai-detector";

describe("isAiUserAgent", () => {
  test("detects known AI bots", () => {
    expect(isAiUserAgent("Mozilla/5.0 (compatible; GPTBot/1.0)")).toBe(true);
    expect(isAiUserAgent("ClaudeBot/1.0")).toBe(true);
    expect(isAiUserAgent("PerplexityBot")).toBe(true);
  });

  test("rejects regular browsers", () => {
    expect(
      isAiUserAgent(
        "Mozilla/5.0 (Macintosh) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
      ),
    ).toBe(false);
  });

  test("handles null/undefined", () => {
    expect(isAiUserAgent(null)).toBe(false);
    expect(isAiUserAgent(undefined)).toBe(false);
    expect(isAiUserAgent("")).toBe(false);
  });
});

describe("detectAiBot", () => {
  test("returns matching bot name", () => {
    expect(detectAiBot("GPTBot/1.0")).toBe("GPTBot");
    expect(detectAiBot("ClaudeBot")).toBe("ClaudeBot");
  });

  test("returns null for non-AI agents", () => {
    expect(detectAiBot("Chrome/120")).toBe(null);
    expect(detectAiBot(null)).toBe(null);
  });
});
