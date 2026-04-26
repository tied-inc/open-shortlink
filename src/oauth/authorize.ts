import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Bindings } from "../bindings";
import { isAllowed, selectIdpMode } from "./idp";
import { readAccessJwt, verifyAccessJwt } from "./idp/access";
import {
  buildUpstreamAuthorizeUrl,
  callbackUrl,
  consumePendingAuth,
  createPkce,
  exchangeCode,
  fetchDiscovery,
  randomState,
  savePendingAuth,
  verifyIdToken,
} from "./idp/oidc";

interface AuthEnv extends Bindings {
  OAUTH_PROVIDER: OAuthHelpers;
}

// ---------------------------------------------------------------------------
// GET /authorize
//
// Entry point for MCP clients (Claude Desktop etc.) beginning the OAuth dance.
// We parse the downstream request to confirm the client is known, then hand
// off to the configured upstream IdP:
//
//   - Access mode: verify the Cf-Access-Jwt-Assertion header that Cloudflare
//     put on the request and complete immediately.
//   - OIDC mode:   stash the downstream request under a random state in KV
//     and redirect the browser to the upstream authorization endpoint.
//
// If neither mode is configured, or both are, we return a 503 so the operator
// is told plainly why MCP is not working (fail-closed).
// ---------------------------------------------------------------------------
export async function handleAuthorize(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const mode = selectIdpMode(env);
  if (mode.kind === "misconfigured") {
    return errorResponse(
      503,
      "server misconfigured",
      mode.reason,
    );
  }

  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);
  if (!client) {
    return errorResponse(400, "unknown client", "client_id not registered");
  }

  if (mode.kind === "access") {
    const jwt = readAccessJwt(request);
    if (!jwt) {
      return errorResponse(
        401,
        "access jwt missing",
        "this endpoint must be fronted by Cloudflare Access; Cf-Access-Jwt-Assertion header was not present",
      );
    }
    const identity = await verifyAccessJwt(jwt, mode);
    if (!identity) {
      return errorResponse(401, "access jwt invalid", "failed to verify signature, issuer, or audience");
    }
    if (!isAllowed(mode, identity)) {
      return errorResponse(
        403,
        "not authorized",
        `${identity.email ?? identity.sub} is not in ACCESS_ALLOWED_EMAILS`,
      );
    }
    const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
      request: oauthReq,
      userId: identity.sub,
      metadata: { idp: "access", email: identity.email ?? null },
      scope: oauthReq.scope,
      props: {
        sub: identity.sub,
        email: identity.email ?? null,
        idp: "access",
      },
    });
    return Response.redirect(redirectTo, 302);
  }

  // OIDC mode: redirect to upstream IdP with PKCE + state + nonce.
  const discovery = await fetchDiscovery(mode.issuer, env);
  const { verifier, challenge } = await createPkce();
  const state = randomState();
  const nonce = randomState();
  const redirectUri = callbackUrl(request);
  await savePendingAuth(env, state, {
    oauthReq,
    pkceVerifier: verifier,
    nonce,
    redirectUri,
    issuer: mode.issuer,
  });
  const upstream = buildUpstreamAuthorizeUrl(discovery, mode, {
    state,
    pkceChallenge: challenge,
    nonce,
    redirectUri,
  });
  return Response.redirect(upstream, 302);
}

// ---------------------------------------------------------------------------
// GET /oauth/callback
//
// Upstream IdP redirects the browser here after the user signs in. We look
// up the pending AuthRequest by `state`, exchange the code for tokens,
// verify the ID token, check the allowlist, and finally complete the
// downstream OAuth authorization so the MCP client gets its code.
// ---------------------------------------------------------------------------
export async function handleOauthCallback(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const mode = selectIdpMode(env);
  // Misconfiguration must surface as 503 (not 404) so the operator sees the
  // same fail-closed signal regardless of which endpoint was hit. A direct
  // GET /oauth/callback while two IdPs are simultaneously configured is a
  // configuration error, not a "this route does not exist" condition.
  if (mode.kind === "misconfigured") {
    return errorResponse(503, "server misconfigured", mode.reason);
  }
  if (mode.kind !== "oidc") {
    return errorResponse(
      404,
      "callback not available",
      "OIDC mode is not configured; /oauth/callback is only used by the OIDC flow",
    );
  }

  const url = new URL(request.url);
  const error = url.searchParams.get("error");
  if (error) {
    const desc = url.searchParams.get("error_description") ?? "";
    return errorResponse(400, `upstream error: ${error}`, desc);
  }
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) {
    return errorResponse(
      400,
      "invalid callback",
      "missing code or state parameter",
    );
  }

  const pending = await consumePendingAuth(env, state);
  if (!pending) {
    return errorResponse(
      400,
      "unknown state",
      "authorization state expired or was already used",
    );
  }
  // Paranoia: if the operator changed OIDC_ISSUER between /authorize and
  // /oauth/callback, reject rather than exchanging a code at a new issuer.
  if (pending.issuer !== mode.issuer) {
    return errorResponse(
      400,
      "issuer changed",
      "OIDC_ISSUER was modified mid-flow; start over",
    );
  }

  const discovery = await fetchDiscovery(mode.issuer, env);
  let tokens;
  try {
    tokens = await exchangeCode(discovery, mode, {
      code,
      pkceVerifier: pending.pkceVerifier,
      redirectUri: pending.redirectUri,
    });
  } catch (err) {
    return errorResponse(
      502,
      "upstream token exchange failed",
      err instanceof Error ? err.message : String(err),
    );
  }
  if (!tokens.id_token) {
    return errorResponse(
      502,
      "upstream missing id_token",
      "token response did not include an id_token; is `openid` in OIDC_SCOPES?",
    );
  }

  const identity = await verifyIdToken(
    tokens.id_token,
    discovery,
    mode,
    pending.nonce,
  );
  if (!identity) {
    return errorResponse(
      401,
      "id token invalid",
      "failed signature, issuer, audience, or nonce check",
    );
  }
  if (!isAllowed(mode, identity)) {
    return errorResponse(
      403,
      "not authorized",
      `${identity.email ?? identity.sub} is not in OIDC_ALLOWED_SUBS`,
    );
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: pending.oauthReq,
    userId: identity.sub,
    metadata: { idp: "oidc", issuer: mode.issuer, email: identity.email ?? null },
    scope: pending.oauthReq.scope,
    props: {
      sub: identity.sub,
      email: identity.email ?? null,
      idp: "oidc",
      issuer: mode.issuer,
    },
  });
  return Response.redirect(redirectTo, 302);
}

function errorResponse(
  status: number,
  error: string,
  description: string,
): Response {
  const body = {
    error,
    description,
    docs: "https://tied-inc.github.io/open-shortlink/guide/security",
  };
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}
