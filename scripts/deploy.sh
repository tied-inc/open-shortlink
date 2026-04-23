#!/bin/bash
# Deploy wrapper that ensures the KV namespace referenced in wrangler.toml
# exists before running `wrangler deploy`.
#
# wrangler.toml ships with the placeholder id `REPLACE_WITH_KV_NAMESPACE_ID`
# so that the repo does not leak an account-specific id. This script resolves
# the placeholder at deploy time by either looking up an existing namespace
# titled "<worker>-<binding>" or creating one, then substituting the id into
# wrangler.toml for the duration of the deploy.
set -euo pipefail

cd "$(dirname "$0")/.."

PLACEHOLDER="REPLACE_WITH_KV_NAMESPACE_ID"
BINDING="SHORTLINKS"
WORKER_NAME="open-shortlink"
TITLE="${WORKER_NAME}-${BINDING}"

if ! grep -q "$PLACEHOLDER" wrangler.toml; then
  echo "KV namespace id already set in wrangler.toml; skipping provisioning."
  exec bunx wrangler deploy "$@"
fi

if ! command -v node >/dev/null 2>&1; then
  echo "error: node is required to parse wrangler output" >&2
  exit 1
fi

echo "Looking up KV namespace titled \"$TITLE\"..."
NAMESPACE_JSON=$(bunx wrangler kv namespace list 2>/dev/null || echo '[]')
NAMESPACE_ID=$(
  printf '%s' "$NAMESPACE_JSON" | node -e '
    let s = "";
    process.stdin.on("data", c => s += c);
    process.stdin.on("end", () => {
      try {
        const list = JSON.parse(s);
        const match = list.find(n => n.title === process.argv[1]);
        process.stdout.write(match ? match.id : "");
      } catch { process.stdout.write(""); }
    });
  ' "$TITLE"
)

if [ -z "$NAMESPACE_ID" ]; then
  echo "Namespace not found; creating \"$TITLE\"..."
  CREATE_OUTPUT=$(bunx wrangler kv namespace create "$BINDING" 2>&1)
  echo "$CREATE_OUTPUT"
  NAMESPACE_ID=$(printf '%s' "$CREATE_OUTPUT" \
    | grep -Eo 'id = "[^"]+"' \
    | head -n 1 \
    | sed -E 's/^id = "([^"]+)"$/\1/')
fi

if [ -z "$NAMESPACE_ID" ]; then
  echo "error: failed to resolve KV namespace id" >&2
  exit 1
fi

echo "Using KV namespace id: $NAMESPACE_ID"

cleanup() {
  if [ -f wrangler.toml.bak ]; then
    mv wrangler.toml.bak wrangler.toml
  fi
}
trap cleanup EXIT

cp wrangler.toml wrangler.toml.bak
sed -i.sed.tmp "s/$PLACEHOLDER/$NAMESPACE_ID/" wrangler.toml
rm -f wrangler.toml.sed.tmp

bunx wrangler deploy "$@"
