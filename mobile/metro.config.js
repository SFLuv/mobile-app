const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");

/*
 * getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and stamps each
 * bundle with the debug ID that ties it to its uploaded source map. Reverting to
 * getDefaultConfig costs readable stack traces and fails silently.
 */
const config = getSentryExpoConfig(__dirname);

const joseBrowserEntry = path.join(
  path.dirname(require.resolve("jose/package.json")),
  "dist/browser/index.js",
);

/*
 * Privy needs jose's browser entry; without this the bundle resolves the Node
 * build and login breaks.
 *
 * Delegate to the resolver already installed rather than calling
 * metro-resolver's `resolve` directly: getSentryExpoConfig installs its own
 * resolveRequest, and calling metro-resolver against a context that points back
 * here recurses until "Maximum call stack size exceeded", reported against an
 * unrelated module.
 */
const upstreamResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  const target = moduleName === "jose" ? joseBrowserEntry : moduleName;
  const delegate = upstreamResolveRequest ?? context.resolveRequest;
  return delegate(context, target, platform);
};

module.exports = config;
