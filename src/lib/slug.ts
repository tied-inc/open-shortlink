import { customAlphabet } from "nanoid";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEFAULT_LENGTH = 6;

const generator = customAlphabet(ALPHABET, DEFAULT_LENGTH);

export function generateSlug(): string {
  return generator();
}

// Reserved prefixes / exact names that would collide with routing or future
// top-level endpoints. `health` and the empty root are already wired into the
// Worker; the rest are defensively reserved for standard ops/well-known paths.
const RESERVED_PREFIXES = ["api", "mcp"];
const RESERVED_EXACT = new Set([
  "health",
  "healthz",
  "ready",
  "readyz",
  "metrics",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
  ".well-known",
]);
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (!SLUG_PATTERN.test(slug)) return false;
  if (RESERVED_EXACT.has(slug.toLowerCase())) return false;
  return !RESERVED_PREFIXES.some(
    (p) => slug === p || slug.startsWith(`${p}/`) || slug.startsWith(`${p}-`),
  );
}
