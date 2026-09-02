const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

/*
 * getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and adds the
 * debug-id that ties a shipped bundle to its uploaded source map. Reverting to
 * getDefaultConfig costs unminified stack traces and fails silently.
 */
const config = getSentryExpoConfig(__dirname);

const joseBrowserEntry = path.join(
  path.dirname(require.resolve("jose/package.json")),
  "dist/browser/index.js",
);

/*
 * Privy needs jose's browser entry; without this the bundle resolves the Node
 * build and login breaks rather than degrading.
 *
 * Delegate to whatever resolver is already installed instead of calling
 * metro-resolver's `resolve` directly. getSentryExpoConfig installs its own
 * resolveRequest, and calling metro-resolver against a context that already
 * points here recurses until the stack overflows — it surfaces as
 * "RangeError: Maximum call stack size exceeded" while resolving an unrelated
 * module, which is a long way from the actual cause.
 */
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = moduleName === "jose" ? joseBrowserEntry : moduleName;
  const delegate = upstreamResolveRequest ?? context.resolveRequest;
  return delegate(context, target, platform);
};

module.exports = config;
