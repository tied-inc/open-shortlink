# Contributing to Open Shortlink

Thanks for your interest in contributing! This document describes how to set
up the project locally, the workflow we follow, and what to expect when you
open a pull request.

If you are reporting a security issue, please follow [SECURITY.md](./SECURITY.md)
instead of opening a public issue.

## Project at a glance

- **Single Cloudflare Worker** — redirect, REST API, and MCP server are all
  served from `src/index.ts`.
- **Stack** — TypeScript, [Hono](https://hono.dev), [Bun](https://bun.sh) for
  install/test, [Wrangler](https://developers.cloudflare.com/workers/wrangler/)
  for the dev server and deployment.
- **Storage** — Cloudflare KV for slug → URL, Analytics Engine for click data,
  KV again (`OAUTH_KV`) for OAuth state.
- **Auth** — OAuth 2.1 with PKCE; user authentication is delegated to either
  Cloudflare Access or any OpenID Connect provider.

See [SPEC.md](./SPEC.md) for the full specification and the
[documentation site](https://tied-inc.github.io/open-shortlink/) for the
user-facing guides.

## Development setup

```bash
# Prerequisites: Bun >= 1.1
bun install

# Local dev server (wrangler dev). KV namespaces are auto-provisioned.
bun run dev

# Run the test suite
bun test

# TypeScript check
bun run typecheck
```

Copy `.dev.vars.example` to `.dev.vars` and fill in **either** the Cloudflare
Access variables or the OIDC variables. The Worker fails closed (`/authorize`
returns 503) if neither group is set or if the email allowlist is empty.

For deployment, see [`docs/guide/deploy.md`](./docs/guide/deploy.md).

## Branching and pull requests

1. **Fork and branch from `main`.** We do not maintain release branches.
2. **One logical change per PR.** Avoid mixing refactors with feature work.
3. **Keep PRs reviewable.** If a change is large, consider splitting it.
4. **Open the PR as ready for review** (not draft) once CI passes locally.

The PR template will prompt you for a Summary and a Test plan — please fill
both in. Maintainers may ask for changes; addressing them in additional
commits (rather than force-pushing) keeps the review history clear.

## Commits

- Use [Conventional Commits](https://www.conventionalcommits.org/) prefixes:
  `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`.
- The subject line may be in **English or Japanese**, whichever fits your
  change best. Keep it under ~72 characters.
- Reference the issue number in the body when applicable (e.g. `Closes #42`).

## Testing

- All non-trivial changes must include tests in `test/`. Match the style of
  the existing files (Bun's built-in test runner).
- Cover both the happy path and at least one error case (validation error,
  404, missing auth, etc.).
- `bun test` must pass before you push.

## Coding style

- TypeScript strict mode. No `any` unless justified by a comment.
- Validate external input with [zod](https://zod.dev). Don't trust request
  bodies, headers, or query strings without a schema.
- For shortened URLs, run new validation through `src/lib/validate.ts` rather
  than re-implementing host checks. SSRF defenses live there.
- Prefer narrow, focused middleware over large request handlers.
- Don't introduce a new dependency unless it materially simplifies the code.

## Documentation

The user-facing documentation is a VitePress site under `docs/`. When you
add or change behavior:

- Update `docs/api.md` for REST API changes.
- Update `docs/mcp.md` for MCP tool changes.
- Update `docs/guide/security.md` if the change touches authentication, CORS,
  rate limiting, or HTTP security headers.
- Update `docs/guide/architecture.md` if the change adds a new layer or
  binding.
- Update [SPEC.md](./SPEC.md) for any spec-level change (endpoints, schemas,
  reserved slugs, validation rules).

The `docs/` directory has a Japanese-first version today. English
translations are welcome — please open an issue first so we can coordinate.

## Reporting bugs and requesting features

- Use the issue templates under [.github/ISSUE_TEMPLATE](.github/ISSUE_TEMPLATE).
- Include a minimal reproduction (request payload, response, expected vs.
  actual).
- For feature requests, describe the use case before proposing an
  implementation. Smaller, well-motivated proposals land faster than large
  speculative ones.

## License

By contributing, you agree that your contributions will be licensed under
the [MIT License](./LICENSE).
