import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthRequest } from "@cloudflare/workers-oauth-provider";
import type { Bindings } from "../../bindings";
import type { Identity, IdpMode } from "./index";

// Upstream OpenID Connect delegation. This Worker acts as an OIDC Relying
// Party: on /authorize we redirect the user to the configured issuer, and on
// /oauth/callback we exchange the code, verify the ID token, and complete
// the downstream OAuth authorization for the MCP client.

interface DiscoveryDocument {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
  // userinfo_endpoint is optional per OIDC spec; we rely on ID token claims
  // and do not fetch userinfo.
  userinfo_endpoint?: string;
}

// Discovery docs change rarely. Cache in OAUTH_KV for 6h so cold starts don't
// pay the round-trip, and multiple workers share the same cached copy.
const DISCOVERY_TTL_SECONDS = 6 * 60 * 60;

// State and per-auth request bundle live in KV for the short window between
// /authorize and /oauth/callback. 10 minutes is generous but well under any
// upstream auth session — longer than that and the user likely bailed out.
export const UPSTREAM_STATE_TTL_SECONDS = 600;

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function getJwks(jwksUri: string) {
  let set = jwksCache.get(jwksUri);
  if (!set) {
    set = createRemoteJWKSet(new URL(jwksUri), {
      cacheMaxAge: 60 * 60 * 1000,
    });
    jwksCache.set(jwksUri, set);
  }
  return set;
}

export async function fetchDiscovery(
  issuer: string,
  env: Bindings,
): Promise<DiscoveryDocument> {
  const cacheKey = `oidc_discovery:${issuer}`;
  const cached = await env.OAUTH_KV.get(cacheKey);
  if (cached) {
    try {
      return JSON.parse(cached) as DiscoveryDocument;
    } catch {
      // fall through to refetch
    }
  }
  const url = `${issuer}/.well-known/openid-configuration`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${url}`);
  }
  const doc = (await res.json()) as DiscoveryDocument;
  if (
    !doc.issuer ||
    !doc.authorization_endpoint ||
    !doc.token_endpoint ||
    !doc.jwks_uri
  ) {
    throw new Error("OIDC discovery document is missing required fields");
  }
  // Spec requires the `issuer` in the document to match the requested URL.
  // Accept a trailing-slash mismatch but otherwise refuse — a mismatch means
  // the IdP is misconfigured or we're talking to the wrong endpoint.
  if (doc.issuer.replace(/\/+$/, "") !== issuer.replace(/\/+$/, "")) {
    throw new Error(
      `OIDC discovery issuer mismatch: expected ${issuer}, got ${doc.issuer}`,
    );
  }
  await env.OAUTH_KV.put(cacheKey, JSON.stringify(doc), {
    expirationTtl: DISCOVERY_TTL_SECONDS,
  });
  return doc;
}

function base64UrlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function randomBase64Url(byteLength: number): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function createPkce(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = randomBase64Url(32);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  const challenge = base64UrlEncode(new Uint8Array(digest));
  return { verifier, challenge };
}

export function randomState(): string {
  return randomBase64Url(32);
}

export function callbackUrl(request: Request): string {
  const url = new URL(request.url);
  return `${url.protocol}//${url.host}/oauth/callback`;
}

// Serialized form of the original downstream AuthRequest plus the PKCE and
// nonce values we generated for the upstream call. Stashed in KV under the
// upstream state value so the callback can reconstruct everything it needs.
export interface PendingUpstreamAuth {
  oauthReq: AuthRequest;
  pkceVerifier: string;
  nonce: string;
  redirectUri: string;
  issuer: string;
}

function stateKey(state: string): string {
  return `upstream_oidc_state:${state}`;
}

export async function savePendingAuth(
  env: Bindings,
  state: string,
  pending: PendingUpstreamAuth,
): Promise<void> {
  await env.OAUTH_KV.put(stateKey(state), JSON.stringify(pending), {
    expirationTtl: UPSTREAM_STATE_TTL_SECONDS,
  });
}

export async function consumePendingAuth(
  env: Bindings,
  state: string,
): Promise<PendingUpstreamAuth | null> {
  const raw = await env.OAUTH_KV.get(stateKey(state));
  if (!raw) return null;
  await env.OAUTH_KV.delete(stateKey(state));
  try {
    return JSON.parse(raw) as PendingUpstreamAuth;
  } catch {
    return null;
  }
}

export function buildUpstreamAuthorizeUrl(
  discovery: DiscoveryDocument,
  mode: Extract<IdpMode, { kind: "oidc" }>,
  params: {
    state: string;
    pkceChallenge: string;
    nonce: string;
    redirectUri: string;
  },
): string {
  const url = new URL(discovery.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", mode.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", mode.scopes);
  url.searchParams.set("state", params.state);
  url.searchParams.set("nonce", params.nonce);
  url.searchParams.set("code_challenge", params.pkceChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  id_token?: string;
  token_type?: string;
  expires_in?: number;
}

export async function exchangeCode(
  discovery: DiscoveryDocument,
  mode: Extract<IdpMode, { kind: "oidc" }>,
  params: { code: string; pkceVerifier: string; redirectUri: string },
): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: mode.clientId,
    client_secret: mode.clientSecret,
    code_verifier: params.pkceVerifier,
  });
  const res = await fetch(discovery.token_endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json",
    },
    body,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `upstream token exchange failed: ${res.status} ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

export async function verifyIdToken(
  idToken: string,
  discovery: DiscoveryDocument,
  mode: Extract<IdpMode, { kind: "oidc" }>,
  expectedNonce: string,
): Promise<Identity | null> {
  try {
    const jwks = getJwks(discovery.jwks_uri);
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: discovery.issuer,
      audience: mode.clientId,
    });
    if (typeof payload.nonce !== "string" || payload.nonce !== expectedNonce) {
      return null;
    }
    const sub = typeof payload.sub === "string" ? payload.sub : null;
    if (!sub) return null;
    const email =
      typeof payload.email === "string" ? payload.email : undefined;
    return { sub, email };
  } catch {
    return null;
  }
}
