# Security Policy

Open Shortlink takes security seriously. This document describes how to report
vulnerabilities and which versions receive fixes.

For operator-facing guidance (deployment hardening, OAuth configuration, IdP
allowlists, rate limiting, edge cache behavior, etc.), see the
[Security Guide](https://tied-inc.github.io/open-shortlink/guide/security).

## Supported Versions

Open Shortlink ships from `main` and is deployed by each operator to their
own Cloudflare account. Only the latest commit on `main` receives security
fixes; there are no long-term-support branches.

If you have forked the project, you are responsible for pulling fixes into
your fork.

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Use GitHub's private vulnerability reporting instead:

1. Go to https://github.com/tied-inc/open-shortlink/security/advisories/new
2. Fill in the advisory form with as much detail as you can:
   - The component or endpoint affected (e.g. `/api/links`, `/oauth/callback`,
     `/:slug`)
   - The Cloudflare Worker version / commit hash you tested against
   - A proof-of-concept request, payload, or repro steps
   - The impact you observed (information disclosure, privilege escalation,
     SSRF, open redirect, etc.)
3. Submit. The maintainers receive a private notification.

If you cannot use GitHub's reporting flow for any reason, you may instead
open a minimal public issue that says only *"requesting a private security
contact"* — the maintainers will reach out via your GitHub-registered email.
Do not include any details of the vulnerability in that public issue.

### What to expect

- **Acknowledgement**: within 5 business days.
- **Triage and severity assessment**: within 10 business days of acknowledgement.
- **Fix timeline**: depends on severity. Critical issues are prioritized; lower-
  severity issues may be batched with the next release.
- **Disclosure**: once a fix is merged to `main`, the maintainers publish a
  GitHub Security Advisory crediting the reporter (unless they prefer to
  remain anonymous).

## Scope

In scope:

- The Worker source code in this repository (`src/`)
- The OAuth 2.1 / OIDC delegation flow (`/authorize`, `/oauth/callback`,
  `/register`, `/token`)
- The REST API (`/api/*`) and MCP endpoint (`/mcp`)
- The redirect endpoint (`GET /:slug`) including geo-variant lookup
- URL validation (`src/lib/validate.ts`) and slug validation
- Documentation that incorrectly describes a security-relevant default

Out of scope:

- Vulnerabilities in operators' own Cloudflare account configuration (e.g.
  missing WAF rules, weak IdP settings, unrestricted email allowlists).
  These are operator responsibilities — see the Security Guide.
- Findings that depend on the operator deliberately disabling fail-closed
  defaults (e.g. wildcard `CORS_ALLOW_ORIGIN`, unbounded `OIDC_ALLOWED_SUBS`).
- Denial-of-service from raw request volume against a single Worker isolate.
  The Worker provides a per-isolate rate-limit safety net; global enforcement
  is the operator's responsibility via Cloudflare Rate Limiting Rules.
- Issues in upstream dependencies (Hono, jose, nanoid, etc.) — please report
  those to the upstream project. Exception: a misuse of the dependency *in
  this repository* that creates a vulnerability is in scope.

## Safe Harbor

We support good-faith security research. If you make a reasonable effort to
follow this policy, we will not pursue or support legal action against you.
Please:

- Test only against deployments you own or have explicit permission to test.
- Avoid privacy violations, data destruction, and service degradation.
- Do not use social engineering, phishing, or physical attacks.
