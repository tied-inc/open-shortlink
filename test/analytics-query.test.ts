import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { AnalyticsQuery } from "../src/analytics/query";

interface StubCall {
  url: string;
  sql: string;
  auth: string;
}

let calls: StubCall[] = [];
let nextResponses: unknown[][] = [];
const originalFetch = globalThis.fetch;

function stubFetch() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : String(input);
    const auth = (init?.headers as Record<string, string>)?.Authorization ?? "";
    calls.push({ url, sql: String(init?.body ?? ""), auth });
    const data = nextResponses.shift() ?? [];
    return new Response(JSON.stringify({ data }), { status: 200 });
  }) as typeof fetch;
}

function queueResponse(data: unknown[]) {
  nextResponses.push(data);
}

describe("AnalyticsQuery", () => {
  let q: AnalyticsQuery;

  beforeEach(() => {
    calls = [];
    nextResponses = [];
    stubFetch();
    q = new AnalyticsQuery({ accountId: "acct", apiToken: "tok" });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("runSql sends bearer token and returns data array", async () => {
    queueResponse([{ x: 1 }, { x: 2 }]);
    const rows = await q.runSql<{ x: number }>("SELECT 1");
    expect(rows).toEqual([{ x: 1 }, { x: 2 }]);
    expect(calls[0]?.auth).toBe("Bearer tok");
    expect(calls[0]?.url).toContain("/accounts/acct/analytics_engine/sql");
    expect(calls[0]?.sql).toBe("SELECT 1");
  });

  test("runSql throws on non-2xx", async () => {
    globalThis.fetch = (async () =>
      new Response("bad", { status: 400 })) as typeof fetch;
    await expect(q.runSql("SELECT 1")).rejects.toThrow(
      /Analytics Engine query failed/,
    );
  });

  test("getSlugAnalytics aggregates totals, referers, countries", async () => {
    queueResponse([{ total: 100, ai: 10, countries: 3 }]);
    queueResponse([
      { referer: "https://twitter.com", clicks: 50 },
      { referer: "https://github.com", clicks: 20 },
    ]);
    queueResponse([
      { country: "JP", clicks: 60 },
      { country: "US", clicks: 40 },
    ]);

    const stats = await q.getSlugAnalytics("abc", "7d");
    expect(stats.totalClicks).toBe(100);
    expect(stats.aiClicks).toBe(10);
    expect(stats.humanClicks).toBe(90);
    expect(stats.uniqueCountries).toBe(3);
    expect(stats.topReferers).toHaveLength(2);
    expect(stats.topCountries[0]?.country).toBe("JP");
  });

  test("getSlugAnalytics escapes single quotes in slug", async () => {
    queueResponse([]);
    queueResponse([]);
    queueResponse([]);
    await q.getSlugAnalytics("a'b", "7d");
    // all three queries should have the escaped slug
    for (const call of calls) {
      expect(call.sql).toContain("'a''b'");
    }
  });

  test("getTopLinks normalizes numeric clicks", async () => {
    queueResponse([
      { slug: "a", clicks: "100" },
      { slug: "b", clicks: 50 },
    ]);
    const top = await q.getTopLinks("7d", 10);
    expect(top).toEqual([
      { slug: "a", clicks: 100 },
      { slug: "b", clicks: 50 },
    ]);
  });

  test("getAiStats groups by detected bot", async () => {
    queueResponse([{ total: 100, ai: 20 }]);
    queueResponse([
      { user_agent: "Mozilla/5.0 GPTBot/1.0", clicks: 10 },
      { user_agent: "GPTBot v2", clicks: 5 },
      { user_agent: "ClaudeBot/1.0", clicks: 5 },
    ]);

    const stats = await q.getAiStats("7d");
    expect(stats.totalClicks).toBe(100);
    expect(stats.aiClicks).toBe(20);
    expect(stats.humanClicks).toBe(80);
    expect(stats.aiRatio).toBeCloseTo(0.2);

    const gptTotal = stats.byBot.find((b) => b.bot === "GPTBot")?.clicks;
    expect(gptTotal).toBe(15);
  });

  test("getAiStats returns zero ratio on empty data", async () => {
    queueResponse([{ total: 0, ai: 0 }]);
    queueResponse([]);
    const stats = await q.getAiStats("7d");
    expect(stats.aiRatio).toBe(0);
  });

  test("getTimeseries parses bucket timestamps", async () => {
    queueResponse([
      { bucket: "2025-01-01T00:00:00Z", clicks: 10, ai: 1 },
      { bucket: "2025-01-02T00:00:00Z", clicks: 20, ai: 2 },
    ]);
    const points = await q.getTimeseries("abc", "7d", "1d");
    expect(points).toHaveLength(2);
    expect(points[0]?.clicks).toBe(10);
    expect(points[0]?.aiClicks).toBe(1);
    expect(new Date(points[0]!.timestamp).getTime()).toBeGreaterThan(0);
  });
});
