import { describe, expect, test } from "bun:test";
import { generateSlug, isValidSlug } from "../src/lib/slug";

describe("generateSlug", () => {
  test("generates 6-character slug", () => {
    const slug = generateSlug();
    expect(slug).toHaveLength(6);
  });

  test("generates unique slugs", () => {
    const slugs = new Set(Array.from({ length: 100 }, generateSlug));
    expect(slugs.size).toBe(100);
  });

  test("uses only base62 characters", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateSlug()).toMatch(/^[A-Za-z0-9]{6}$/);
    }
  });
});

describe("isValidSlug", () => {
  test("accepts alphanumeric and hyphens/underscores", () => {
    expect(isValidSlug("abc123")).toBe(true);
    expect(isValidSlug("my-slug")).toBe(true);
    expect(isValidSlug("my_slug")).toBe(true);
  });

  test("rejects empty or invalid characters", () => {
    expect(isValidSlug("")).toBe(false);
    expect(isValidSlug("has space")).toBe(false);
    expect(isValidSlug("has/slash")).toBe(false);
    expect(isValidSlug("日本語")).toBe(false);
  });

  test("rejects reserved prefixes", () => {
    expect(isValidSlug("api")).toBe(false);
    expect(isValidSlug("mcp")).toBe(false);
    expect(isValidSlug("api-links")).toBe(false);
  });

  test("rejects slugs longer than 64 chars", () => {
    expect(isValidSlug("a".repeat(65))).toBe(false);
    expect(isValidSlug("a".repeat(64))).toBe(true);
  });
});
