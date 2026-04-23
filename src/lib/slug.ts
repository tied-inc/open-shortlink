import { customAlphabet } from "nanoid";

const ALPHABET =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const DEFAULT_LENGTH = 6;

const generator = customAlphabet(ALPHABET, DEFAULT_LENGTH);

export function generateSlug(): string {
  return generator();
}

// Reserved prefixes that would collide with routing.
const RESERVED_PREFIXES = ["api", "mcp"];
const SLUG_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

export function isValidSlug(slug: string): boolean {
  if (!SLUG_PATTERN.test(slug)) return false;
  return !RESERVED_PREFIXES.some(
    (p) => slug === p || slug.startsWith(`${p}/`) || slug.startsWith(`${p}-`),
  );
}
