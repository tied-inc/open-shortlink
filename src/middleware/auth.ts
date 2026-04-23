import type { MiddlewareHandler } from "hono";
import type { Bindings } from "../bindings";

// Minimum length we are willing to accept for API_TOKEN. 32 random bytes (≈43
// base64 chars) is the rule-of-thumb floor for bearer credentials; anything
// shorter is almost certainly a copy-pasted placeholder.
const MIN_TOKEN_LENGTH = 24;

// Well-known example tokens we ship in documentation or .dev.vars.example.
// Refusing them outright prevents a live deploy with the sample token — a
// common foot-gun when following a README.
const FORBIDDEN_TOKEN_VALUES: readonly string[] = [
  "dev-token-change-me",
  "changeme",
  "change-me",
  "test-token",
  "password",
  "secret",
];

// Constant-time comparison over UTF-8 bytes. Operates on equal-length padded
// buffers so the loop runs for max(a,b) iterations regardless of input length,
// avoiding length-based timing leaks that a naive `if (a.length !== b.length)
// return false` would introduce.
function timingSafeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  const len = Math.max(aBytes.length, bBytes.length, 1);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < len; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

function isUsableToken(token: string): boolean {
  if (!token) return false;
  if (token.length < MIN_TOKEN_LENGTH) return false;
  if (FORBIDDEN_TOKEN_VALUES.includes(token)) return false;
  return true;
}

// Per-isolate flag so the misconfiguration warning is logged once per cold
// start instead of on every protected request. Operators watching
// `wrangler tail` will see it on first traffic without log spam.
let misconfigurationWarned = false;

export const bearerAuth: MiddlewareHandler<{ Bindings: Bindings }> = async (
  c,
  next,
) => {
  const expected = c.env.API_TOKEN ?? "";

  // Refuse to serve the protected API when the operator has not set a strong
  // token. Surfaces misconfiguration loudly rather than allowing the deploy
  // to accept the placeholder token shipped with the template.
  if (!isUsableToken(expected)) {
    if (!misconfigurationWarned) {
      misconfigurationWarned = true;
      console.error(
        JSON.stringify({
          level: "error",
          event: "api_token_misconfigured",
          message:
            "API_TOKEN is unset, too short (<24 chars), or a known placeholder. /api/* and /mcp* are fail-closed at 503 until it is fixed.",
          docs: "https://tied-inc.github.io/open-shortlink/guide/security",
        }),
      );
    }
    return c.json(
      {
        error:
          "server misconfigured: API_TOKEN must be set to a strong random value (>= 24 chars)",
        docs: "https://tied-inc.github.io/open-shortlink/guide/security",
      },
      503,
      { "WWW-Authenticate": 'Bearer realm="open-shortlink"' },
    );
  }

  const header = c.req.header("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!timingSafeEqual(token, expected)) {
    return c.json({ error: "unauthorized" }, 401, {
      "WWW-Authenticate": 'Bearer realm="open-shortlink"',
    });
  }
  return next();
};
