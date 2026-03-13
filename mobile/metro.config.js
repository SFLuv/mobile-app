const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");
const { resolve } = require("metro-resolver");

const config = getDefaultConfig(__dirname);

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
