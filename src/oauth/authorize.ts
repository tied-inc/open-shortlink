import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import type { Bindings } from "../bindings";
import { timingSafeEqual } from "../lib/crypto";

interface AuthEnv extends Bindings {
  OAUTH_PROVIDER: OAuthHelpers;
}

export async function handleAuthorize(
  request: Request,
  env: AuthEnv,
): Promise<Response> {
  const oauthReq = await env.OAUTH_PROVIDER.parseAuthRequest(request);
  const client = await env.OAUTH_PROVIDER.lookupClient(oauthReq.clientId);

  if (!client) {
    return new Response("Unknown client", { status: 400 });
  }

  if (request.method === "GET") {
    return new Response(renderPage(client.clientName ?? oauthReq.clientId), {
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }

  // POST: validate submitted API token
  const form = await request.formData();
  const token = (form.get("api_token") as string) ?? "";
  const expected = env.API_TOKEN ?? "";

  if (!token || !expected || !timingSafeEqual(token, expected)) {
    return new Response(
      renderPage(client.clientName ?? oauthReq.clientId, "Invalid API token"),
      { status: 401, headers: { "content-type": "text/html; charset=utf-8" } },
    );
  }

  const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
    request: oauthReq,
    userId: "owner",
    metadata: { label: "mcp" },
    scope: oauthReq.scope,
    props: { role: "owner" },
  });

  return Response.redirect(redirectTo, 302);
}

function renderPage(clientName: string, error?: string): string {
  return `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize - Open Shortlink</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:system-ui,-apple-system,sans-serif;background:#f5f5f5;display:flex;justify-content:center;align-items:center;min-height:100vh;padding:1rem}
.card{background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,.1);max-width:400px;width:100%;padding:2rem}
h1{font-size:1.25rem;margin-bottom:.5rem}
p{color:#666;font-size:.875rem;margin-bottom:1.5rem}
.client{font-weight:600;color:#333}
label{display:block;font-size:.875rem;font-weight:500;margin-bottom:.5rem}
input[type=password]{width:100%;padding:.625rem;border:1px solid #ddd;border-radius:6px;font-size:.875rem;margin-bottom:1rem}
input[type=password]:focus{outline:none;border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.2)}
button{width:100%;padding:.625rem;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:.875rem;font-weight:500;cursor:pointer}
button:hover{background:#1d4ed8}
.error{background:#fef2f2;color:#dc2626;padding:.75rem;border-radius:6px;font-size:.875rem;margin-bottom:1rem}
</style>
</head>
<body>
<div class="card">
<h1>Authorize</h1>
<p><span class="client">${escapeHtml(clientName)}</span> wants to access your Open Shortlink MCP server.</p>
${error ? `<div class="error">${escapeHtml(error)}</div>` : ""}
<form method="POST">
<label for="api_token">API Token</label>
<input type="password" id="api_token" name="api_token" required autocomplete="off" placeholder="Enter your API token">
<button type="submit">Authorize</button>
</form>
</div>
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
