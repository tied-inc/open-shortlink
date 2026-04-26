import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Identity, IdpMode } from "./index";

// Cloudflare Access signs every request that passes its policy with a JWT in
// the `Cf-Access-Jwt-Assertion` header (and the CF_Authorization cookie). We
// verify against the team's public JWKS and extract the end-user identity.
//
// Docs: https://developers.cloudflare.com/cloudflare-one/identity/authorization-cookie/validating-json/

// JWKS instances cache keys per-isolate. We keep a tiny Map keyed by the full
// JWKS URL so swapping teams in tests doesn't poison the cache.
const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(teamDomain: string) {
  const url = new URL(
    `https://${teamDomain}/cdn-cgi/access/certs`,
  );
  const key = url.toString();
  let set = jwksCache.get(key);
  if (!set) {
    set = createRemoteJWKSet(url, { cacheMaxAge: 60 * 60 * 1000 });
    jwksCache.set(key, set);
  }
  return set;
}

export function readAccessJwt(request: Request): string | null {
  const header = request.headers.get("cf-access-jwt-assertion");
  if (header) return header;
  // Fall back to the CF_Authorization cookie that Access sets on browser
  // sessions (header is only present for programmatic calls routed through
  // Access service tokens, not interactive users).
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const pair of cookie.split(";")) {
    const [name, ...rest] = pair.trim().split("=");
    if (name === "CF_Authorization") return rest.join("=");
  }
  return null;
}

export async function verifyAccessJwt(
  token: string,
  mode: Extract<IdpMode, { kind: "access" }>,
): Promise<Identity | null> {
  try {
    const issuer = `https://${mode.teamDomain}`;
    const jwks = getJwks(mode.teamDomain);
    const { payload } = await jwtVerify(token, jwks, {
      issuer,
      audience: mode.aud,
    });
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) return null;
    const email =
      typeof payload.email === "string" ? payload.email : undefined;
    return { sub, email };
  } catch {
    return null;
  }
}
