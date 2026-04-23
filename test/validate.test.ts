import { describe, expect, test } from "bun:test";
import { isValidUrl } from "../src/lib/validate";

describe("isValidUrl", () => {
  test("accepts http and https URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
    expect(isValidUrl("https://example.com/path?q=1")).toBe(true);
  });

  test("rejects non-http schemes", () => {
    expect(isValidUrl("ftp://example.com")).toBe(false);
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
    expect(isValidUrl("data:text/plain,hi")).toBe(false);
  });

  test("rejects malformed URLs", () => {
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });
});
