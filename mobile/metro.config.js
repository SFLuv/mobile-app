const path = require("path");
const { getSentryExpoConfig } = require("@sentry/react-native/metro");
const { resolve } = require("metro-resolver");

/*
 * getSentryExpoConfig wraps expo/metro-config's getDefaultConfig and adds the
 * debug-id that ties a shipped bundle to its uploaded source map. Reverting to
 * getDefaultConfig costs unminified stack traces and fails silently.
 *
 * The jose resolver override below must survive that swap — Privy needs jose's
 * browser entry, and dropping it breaks login rather than degrading it.
 */
const config = getSentryExpoConfig(__dirname);

const joseBrowserEntry = path.join(
  path.dirname(require.resolve("jose/package.json")),
  "dist/browser/index.js",
);

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "jose") {
    return resolve(context, joseBrowserEntry, platform);
  }
  return resolve(context, moduleName, platform);
};

module.exports = config;
