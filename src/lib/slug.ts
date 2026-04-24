import { customAlphabet } from "nanoid";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEFAULT_LENGTH = 6;

const generator = customAlphabet(ALPHABET, DEFAULT_LENGTH);

export function generateSlug(): string {
  return generator();
}

// Reserved prefixes that would collide with routing or conventional paths
// served directly by the worker (robots, favicon, health checks, sitemap,
// well-known) as well as the OAuth endpoint paths and additional ops-style
// names that should not become user-visible short links.
const RESERVED_PREFIXES = [
  "api",
  "mcp",
  "health",
  "healthz",
  "ready",
  "readyz",
  "metrics",
  "robots",
  "favicon",
  "sitemap",
  "well-known",
  "authorize",
  "token",
  "register",
  "oauth",
];
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidSlug(slug: string): boolean {
  if (typeof slug !== "string") return false;
  if (!SLUG_PATTERN.test(slug)) return false;
  return !RESERVED_PREFIXES.some(
    (p) => slug === p || slug.startsWith(`${p}/`) || slug.startsWith(`${p}-`),
  );
}
