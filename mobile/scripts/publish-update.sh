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

eval "$(node -e '
  const env = require("./eas.json").build.production.env;
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
