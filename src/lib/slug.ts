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

// Format-only check. Use this when the call site needs to reject malformed
// input (weird characters, wrong length) before hitting KV — e.g. on
// GET / DELETE / analytics routes where any well-formed slug is fair game,
// including ones that happen to share a prefix with a worker route.
//
// A slug like "token-sale" is unreachable through the redirect handler if
// it would collide with a worker route, but if it was successfully created
// in the past (or via a path that bypassed the create-time guard) the
// owner must still be able to look it up and delete it.
export function isValidSlugFormat(slug: string): boolean {
  if (typeof slug !== "string") return false;
  return SLUG_PATTERN.test(slug);
}

// Strict check used at link-creation time. Adds the reserved-prefix guard
// on top of `isValidSlugFormat` so brand-new slugs cannot collide with
// existing worker routes.
export function isValidSlug(slug: string): boolean {
  if (!isValidSlugFormat(slug)) return false;
  return !RESERVED_PREFIXES.some(
    (p) => slug === p || slug.startsWith(`${p}/`) || slug.startsWith(`${p}-`),
  );
}
