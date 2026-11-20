#!/usr/bin/env bash
# Publishes an over-the-air update with the same settings as a store build.
#
# EXPO_PUBLIC_* values are baked in when the bundle is made, and `eas update`
# does not read the env blocks in eas.json. Without them the app falls back to
# localhost and an empty Privy ID, and nobody can sign in. This script loads the
# production values, bundles, checks the bundle, and only then publishes it.
#
# Usage: scripts/publish-update.sh <preview|production> "message"
#        scripts/publish-update.sh check    (bundles and checks, publishes nothing)
set -euo pipefail
cd "$(dirname "$0")/.."

channel="${1:-}"
message="${2:-}"
case "$channel" in
  check) ;;
  preview|production)
    [ -n "$message" ] || { echo "A message is required." >&2; exit 1; }
    ;;
  *) echo "Usage: $0 <preview|production|check> \"message\"" >&2; exit 1 ;;
esac

# Everything an update carries must also reach the next store build, so only
# publish committed code that is already on the remote.
if [ "$channel" != check ]; then
  [ -z "$(git status --porcelain -- . ':!dist')" ] || { echo "Uncommitted changes: commit and push before publishing." >&2; exit 1; }
  git fetch -q origin
  upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>/dev/null)" || { echo "This branch has no remote: push it before publishing." >&2; exit 1; }
  git merge-base --is-ancestor HEAD "$upstream" || { echo "HEAD is not on $upstream: push before publishing." >&2; exit 1; }
fi

# The preview channel serves preview builds, so it also takes the preview
# profile's overrides (its Sentry environment is "preview", not "production").
eval "$(CHANNEL="$channel" node -e '
  const { build } = require("./eas.json");
  const env = { ...build.production.env, ...(process.env.CHANNEL === "preview" ? build.preview.env : {}) };
  for (const [k, v] of Object.entries(env)) console.log(`export ${k}=${JSON.stringify(v)}`);
')"

rm -rf dist
npx expo export --platform ios --platform android --output-dir dist

node -e '
  const fs = require("fs"), path = require("path");
  const { build } = require("./eas.json");
  const env = build.production.env;
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
  const bundles = walk("dist").filter((f) => f.endsWith(".hbc"));
  if (bundles.length !== 2) throw new Error(`expected 2 bundles, found ${bundles.length}`);
  for (const f of bundles) {
    const b = fs.readFileSync(f).toString("latin1");
    for (const want of [env.EXPO_PUBLIC_APP_BACKEND_URL, env.EXPO_PUBLIC_PRIVY_APP_ID]) {
      if (!b.includes(want)) throw new Error(`${f} is missing ${want}`);
    }
    if (b.includes("localhost:8080")) throw new Error(`${f} still points at localhost`);
  }
  console.log("Bundle check passed.");
'

[ "$channel" = check ] && exit 0

npx eas-cli update --channel "$channel" --message "$message" --skip-bundler --input-dir dist --platform all --non-interactive
