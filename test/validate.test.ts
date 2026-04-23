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
    expect(isValidUrl("file:///etc/passwd")).toBe(false);
    expect(isValidUrl("gopher://example.com")).toBe(false);
  });

  test("rejects malformed URLs", () => {
    expect(isValidUrl("not a url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
  });

  test("rejects URLs with embedded credentials", () => {
    expect(isValidUrl("http://user:pass@example.com")).toBe(false);
    expect(isValidUrl("https://admin@example.com")).toBe(false);
  });

  test("rejects localhost and loopback", () => {
    expect(isValidUrl("http://localhost")).toBe(false);
    expect(isValidUrl("http://localhost:8080/admin")).toBe(false);
    expect(isValidUrl("http://127.0.0.1")).toBe(false);
    expect(isValidUrl("http://127.127.127.127")).toBe(false);
    expect(isValidUrl("http://[::1]/")).toBe(false);
  });

  test("rejects link-local and cloud metadata IPs", () => {
    // AWS / GCP / Azure metadata service lives here.
    expect(isValidUrl("http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(isValidUrl("http://169.254.0.1")).toBe(false);
  });

  test("rejects RFC1918 private ranges", () => {
    expect(isValidUrl("http://10.0.0.1")).toBe(false);
    expect(isValidUrl("http://10.255.255.255")).toBe(false);
    expect(isValidUrl("http://172.16.0.1")).toBe(false);
    expect(isValidUrl("http://172.31.255.254")).toBe(false);
    expect(isValidUrl("http://192.168.1.1")).toBe(false);
  });

  test("accepts 172.15 / 172.32 (outside RFC1918 172.16-31 block)", () => {
    expect(isValidUrl("http://172.15.0.1")).toBe(true);
    expect(isValidUrl("http://172.32.0.1")).toBe(true);
  });

  test("rejects 0.0.0.0 and multicast / broadcast", () => {
    expect(isValidUrl("http://0.0.0.0")).toBe(false);
    expect(isValidUrl("http://255.255.255.255")).toBe(false);
    expect(isValidUrl("http://224.0.0.1")).toBe(false);
  });

  test("rejects CGNAT 100.64.0.0/10", () => {
    expect(isValidUrl("http://100.64.0.1")).toBe(false);
    expect(isValidUrl("http://100.127.255.254")).toBe(false);
  });

  test("rejects IPv6 private / link-local / ULA", () => {
    expect(isValidUrl("http://[fe80::1]/")).toBe(false);
    expect(isValidUrl("http://[fc00::1]/")).toBe(false);
    expect(isValidUrl("http://[fd12:3456:789a::1]/")).toBe(false);
    expect(isValidUrl("http://[ff00::1]/")).toBe(false);
  });

  test("rejects IPv4-mapped IPv6 that points at private v4", () => {
    expect(isValidUrl("http://[::ffff:127.0.0.1]/")).toBe(false);
    expect(isValidUrl("http://[::ffff:10.0.0.1]/")).toBe(false);
  });

  test("rejects internal TLDs", () => {
    expect(isValidUrl("http://intranet.local")).toBe(false);
    expect(isValidUrl("http://service.internal")).toBe(false);
    expect(isValidUrl("http://foo.localhost")).toBe(false);
    expect(isValidUrl("http://hidden.onion")).toBe(false);
  });

  test("rejects bare hostnames without a dot (intranet search paths)", () => {
    expect(isValidUrl("http://intranet")).toBe(false);
    expect(isValidUrl("http://router/admin")).toBe(false);
  });

  test("rejects URLs longer than 2048 characters", () => {
    const long = "https://example.com/" + "a".repeat(2048);
    expect(isValidUrl(long)).toBe(false);
  });

  test("accepts public hosts", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("https://sub.example.co.jp/path")).toBe(true);
    expect(isValidUrl("http://8.8.8.8")).toBe(true);
  });
});
