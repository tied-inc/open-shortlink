import { beforeEach, describe, expect, test } from "bun:test";
import { LinkStore } from "../src/storage/kv";
import { asMockKV, createMockKV } from "./helpers/mock-kv";

describe("LinkStore", () => {
  let kv: ReturnType<typeof createMockKV>;
  let store: LinkStore;

  beforeEach(() => {
    kv = createMockKV();
    store = new LinkStore(kv);
  });

  test("put stores URL with createdAt metadata", async () => {
    const before = Date.now();
    const link = await store.put("abc", "https://example.com");
    const after = Date.now();

    expect(link.slug).toBe("abc");
    expect(link.url).toBe("https://example.com");
    expect(link.createdAt).toBeGreaterThanOrEqual(before);
    expect(link.createdAt).toBeLessThanOrEqual(after);
    expect(link.expiresAt).toBeUndefined();
  });

  test("put with expiresIn sets expiresAt metadata and TTL", async () => {
    const link = await store.put("abc", "https://example.com", 3600);
    expect(link.expiresAt).toBeGreaterThan(Date.now());
    expect(link.expiresAt! - link.createdAt).toBe(3600 * 1000);
  });

  test("get returns stored link with metadata", async () => {
    await store.put("abc", "https://example.com");
    const link = await store.get("abc");
    expect(link).not.toBeNull();
    expect(link?.url).toBe("https://example.com");
    expect(link?.createdAt).toBeGreaterThan(0);
  });

  test("get returns null for missing key", async () => {
    const link = await store.get("missing");
    expect(link).toBeNull();
  });

  test("exists returns true for existing slug", async () => {
    await store.put("abc", "https://example.com");
    expect(await store.exists("abc")).toBe(true);
    expect(await store.exists("missing")).toBe(false);
  });

  test("delete removes entry", async () => {
    await store.put("abc", "https://example.com");
    await store.delete("abc");
    expect(await store.get("abc")).toBeNull();
  });

  test("list returns all stored links with metadata", async () => {
    await store.put("a", "https://a.example");
    await store.put("b", "https://b.example");
    await store.put("c", "https://c.example");

    const result = await store.list(10);
    expect(result.links).toHaveLength(3);
    expect(result.cursor).toBeUndefined();

    const urls = result.links.map((l) => l.url).sort();
    expect(urls).toEqual([
      "https://a.example",
      "https://b.example",
      "https://c.example",
    ]);
  });

  test("list paginates with cursor", async () => {
    for (let i = 0; i < 5; i++) {
      await store.put(`slug${i}`, `https://${i}.example`);
    }
    const first = await store.list(2);
    expect(first.links).toHaveLength(2);
    expect(first.cursor).toBeDefined();

    const second = await store.list(10, first.cursor);
    expect(second.links.length).toBeGreaterThan(0);
    expect(second.cursor).toBeUndefined();
  });

  test("list avoids per-key kv.get when URL fits in metadata", async () => {
    const mockKv = asMockKV(kv);
    for (let i = 0; i < 5; i++) {
      await store.put(`slug${i}`, `https://${i}.example`);
    }
    mockKv.getCallCount = 0;

    const result = await store.list(10);

    expect(result.links).toHaveLength(5);
    // N+1 eliminated: list triggers zero kv.get calls when URLs fit metadata.
    expect(mockKv.getCallCount).toBe(0);
    expect(result.links.map((l) => l.url).sort()).toEqual([
      "https://0.example",
      "https://1.example",
      "https://2.example",
      "https://3.example",
      "https://4.example",
    ]);
  });

  test("list falls back to kv.get when URL exceeds metadata budget", async () => {
    const mockKv = asMockKV(kv);
    const longUrl = `https://example.com/${"a".repeat(1100)}`;
    await store.put("short", "https://example.com");
    await store.put("long", longUrl);
    mockKv.getCallCount = 0;

    const result = await store.list(10);

    const byName = Object.fromEntries(result.links.map((l) => [l.slug, l.url]));
    expect(byName.short).toBe("https://example.com");
    expect(byName.long).toBe(longUrl);
    // Only the oversized entry triggers a fallback kv.get.
    expect(mockKv.getCallCount).toBe(1);
  });

  test("put with geo variants stores envelope and get returns geo map", async () => {
    const geo = {
      US: "https://example.com/en",
      JP: "https://example.com/ja",
    };
    const link = await store.put("abc", "https://example.com", undefined, geo);
    expect(link.geo).toEqual(geo);

    const fetched = await store.get("abc");
    expect(fetched?.url).toBe("https://example.com");
    expect(fetched?.geo).toEqual(geo);
  });

  test("put without geo stores raw URL and get returns no geo field", async () => {
    await store.put("abc", "https://example.com");
    const fetched = await store.get("abc");
    expect(fetched?.url).toBe("https://example.com");
    expect(fetched?.geo).toBeUndefined();
  });

  test("put with empty geo object is treated as no geo", async () => {
    const link = await store.put("abc", "https://example.com", undefined, {});
    expect(link.geo).toBeUndefined();
    const fetched = await store.get("abc");
    expect(fetched?.geo).toBeUndefined();
  });

  test("list returns default URL for geo-enabled links", async () => {
    await store.put("a", "https://a.example", undefined, {
      US: "https://a.example/en",
    });
    await store.put("b", "https://b.example");

    const result = await store.list(10);
    const byName = Object.fromEntries(
      result.links.map((l) => [l.slug, l.url]),
    );
    expect(byName.a).toBe("https://a.example");
    expect(byName.b).toBe("https://b.example");
  });

  test("expired entries are not returned", async () => {
    const mockKv = asMockKV(kv);
    const baseTime = Date.now();
    mockKv.setClock(() => baseTime);

    await store.put("abc", "https://example.com", 10); // 10s TTL

    mockKv.setClock(() => baseTime + 5000);
    expect(await store.get("abc")).not.toBeNull();

    mockKv.setClock(() => baseTime + 11000);
    expect(await store.get("abc")).toBeNull();
  });
});
