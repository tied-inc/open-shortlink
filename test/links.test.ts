import { beforeEach, describe, expect, test } from "bun:test";
import {
  LinkConflictError,
  LinkNotFoundError,
  LinkService,
  LinkValidationError,
} from "../src/services/links";
import { LinkStore } from "../src/storage/kv";
import { createMockKV } from "./helpers/mock-kv";

describe("LinkService", () => {
  let service: LinkService;

  beforeEach(() => {
    service = new LinkService(
      new LinkStore(createMockKV()),
      "https://short.example",
    );
  });

  test("create generates 6-char slug by default", async () => {
    const link = await service.create({ url: "https://example.com" });
    expect(link.slug).toMatch(/^[A-Za-z0-9]{6}$/);
    expect(link.url).toBe("https://example.com");
    expect(link.shortUrl).toBe(`https://short.example/${link.slug}`);
  });

  test("create accepts custom slug", async () => {
    const link = await service.create({
      url: "https://example.com",
      slug: "my-link",
    });
    expect(link.slug).toBe("my-link");
    expect(link.shortUrl).toBe("https://short.example/my-link");
  });

  test("create rejects invalid URL", async () => {
    await expect(service.create({ url: "not a url" })).rejects.toBeInstanceOf(
      LinkValidationError,
    );
    await expect(
      service.create({ url: "javascript:alert(1)" }),
    ).rejects.toBeInstanceOf(LinkValidationError);
  });

  test("create rejects invalid slug", async () => {
    await expect(
      service.create({ url: "https://example.com", slug: "has space" }),
    ).rejects.toBeInstanceOf(LinkValidationError);
    await expect(
      service.create({ url: "https://example.com", slug: "api" }),
    ).rejects.toBeInstanceOf(LinkValidationError);
  });

  test("create rejects non-positive expiresIn", async () => {
    await expect(
      service.create({ url: "https://example.com", expiresIn: 0 }),
    ).rejects.toBeInstanceOf(LinkValidationError);
    await expect(
      service.create({ url: "https://example.com", expiresIn: -1 }),
    ).rejects.toBeInstanceOf(LinkValidationError);
  });

  test("create rejects target pointing at the shortener host", async () => {
    await expect(
      service.create({ url: "https://short.example/foo" }),
    ).rejects.toBeInstanceOf(LinkValidationError);
    await expect(
      service.create({ url: "https://short.example" }),
    ).rejects.toBeInstanceOf(LinkValidationError);
  });

  test("create throws conflict on duplicate custom slug", async () => {
    await service.create({ url: "https://a.com", slug: "dup" });
    await expect(
      service.create({ url: "https://b.com", slug: "dup" }),
    ).rejects.toBeInstanceOf(LinkConflictError);
  });

  test("create respects expiresIn", async () => {
    const link = await service.create({
      url: "https://example.com",
      expiresIn: 60,
    });
    expect(link.expiresAt).toBeGreaterThan(Date.now());
  });

  test("get returns existing link", async () => {
    const created = await service.create({
      url: "https://example.com",
      slug: "abc",
    });
    const link = await service.get("abc");
    expect(link.slug).toBe("abc");
    expect(link.url).toBe("https://example.com");
    expect(link.shortUrl).toBe(created.shortUrl);
  });

  test("get throws NotFound for missing slug", async () => {
    await expect(service.get("missing")).rejects.toBeInstanceOf(
      LinkNotFoundError,
    );
  });

  test("list returns all links with short URLs", async () => {
    await service.create({ url: "https://a.com", slug: "a" });
    await service.create({ url: "https://b.com", slug: "b" });
    const result = await service.list();
    expect(result.links).toHaveLength(2);
    expect(result.links.every((l) => l.shortUrl.startsWith("https://"))).toBe(
      true,
    );
  });

  test("delete removes existing link", async () => {
    await service.create({ url: "https://example.com", slug: "abc" });
    await service.delete("abc");
    await expect(service.get("abc")).rejects.toBeInstanceOf(LinkNotFoundError);
  });

  test("delete throws NotFound for missing slug", async () => {
    await expect(service.delete("missing")).rejects.toBeInstanceOf(
      LinkNotFoundError,
    );
  });

  test("create accepts geo variants and normalizes country codes", async () => {
    const link = await service.create({
      url: "https://example.com",
      slug: "abc",
      geo: { us: "https://example.com/en", JP: "https://example.com/ja" },
    });
    expect(link.geo).toEqual({
      US: "https://example.com/en",
      JP: "https://example.com/ja",
    });
  });

  test("create rejects invalid country code", async () => {
    await expect(
      service.create({
        url: "https://example.com",
        geo: { USA: "https://example.com/en" },
      }),
    ).rejects.toBeInstanceOf(LinkValidationError);
    await expect(
      service.create({
        url: "https://example.com",
        geo: { "1X": "https://example.com/en" },
      }),
    ).rejects.toBeInstanceOf(LinkValidationError);
  });

  test("create rejects invalid URL inside geo", async () => {
    await expect(
      service.create({
        url: "https://example.com",
        geo: { US: "not-a-url" },
      }),
    ).rejects.toBeInstanceOf(LinkValidationError);
  });

  test("create rejects geo variant pointing at the shortener host", async () => {
    await expect(
      service.create({
        url: "https://example.com",
        geo: { US: "https://short.example/evil" },
      }),
    ).rejects.toBeInstanceOf(LinkValidationError);
  });
});
