import fs from "node:fs";
import path from "node:path";
import { withSentry } from "@sentry/react-native/expo";
import type { ConfigContext, ExpoConfig } from "expo/config";

const DEFAULT_EAS_PROJECT_ID = "457c71a1-29cd-4e60-9be8-04a6e0a6194a";
const DEFAULT_EXPO_OWNER = "sfluv";
const DEFAULT_EXPO_SLUG = "sfluv";
const DEFAULT_IOS_BUNDLE_IDENTIFIER = "org.sfluv.wallet";
const DEFAULT_ANDROID_PACKAGE = "org.sfluv.wallet";
const DEFAULT_SENTRY_ORG = "sfluv";
const DEFAULT_SENTRY_PROJECT = "sfluv-mobile";

function buildExtra(config: ConfigContext["config"]): ExpoConfig["extra"] {
  const baseExtra =
    config.extra && typeof config.extra === "object" ? { ...(config.extra as Record<string, unknown>) } : {};
  const existingEas =
    baseExtra.eas && typeof baseExtra.eas === "object" ? { ...(baseExtra.eas as Record<string, unknown>) } : {};
  const envProjectId = process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim();
  const existingProjectId = typeof existingEas.projectId === "string" ? existingEas.projectId : undefined;
  const projectId = envProjectId || existingProjectId || DEFAULT_EAS_PROJECT_ID;

  return {
    ...baseExtra,
    eas: {
      ...existingEas,
      ...(projectId ? { projectId } : {}),
    },
  };
}

function resolveGoogleServicesFile(): string | undefined {
  const configuredPath = process.env.GOOGLE_SERVICES_FILE?.trim();
  if (configuredPath) {
    return configuredPath;
  }

  const defaultRelativePath = "./google-services.json";
  const defaultAbsolutePath = path.join(__dirname, "google-services.json");
  return fs.existsSync(defaultAbsolutePath) ? defaultRelativePath : undefined;
}

const googleServicesFile = resolveGoogleServicesFile();
const expoOwner = process.env.EXPO_OWNER?.trim() || DEFAULT_EXPO_OWNER;
const expoSlug = process.env.EXPO_SLUG?.trim() || DEFAULT_EXPO_SLUG;

const baseConfig = (config: ConfigContext["config"]): ExpoConfig => ({
  ...config,
  name: "SFLuv",
  slug: expoSlug,
  owner: expoOwner,
  version: "1.0.3",
  description:
    "This app is a nonprofit-run community hub for managing and spending your SFLUV, redeeming perks, and coordinating verified improvers. Improvers can sign up to complete real-world tasks in San Francisco and be rewarded with SFLUV.",
  scheme: "sfluv",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "automatic",
  ios: {
    supportsTablet: false,
    bundleIdentifier: process.env.IOS_BUNDLE_IDENTIFIER?.trim() || DEFAULT_IOS_BUNDLE_IDENTIFIER,
    usesAppleSignIn: true,
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "",
    },
    associatedDomains: ["applinks:app.sfluv.org"],
    infoPlist: {
      CFBundleDisplayName: "SFLuv",
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: process.env.ANDROID_PACKAGE?.trim() || DEFAULT_ANDROID_PACKAGE,
    ...(googleServicesFile ? { googleServicesFile } : {}),
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "",
      },
    },
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#f6f0e2",
    },
    intentFilters: [
      {
        action: "VIEW",
        autoVerify: true,
        category: ["BROWSABLE", "DEFAULT"],
        data: [
          {
            scheme: "https",
            host: "app.sfluv.org",
            pathPrefix: "/",
          },
        ],
      },
    ],
  },
  plugins: [
    "expo-asset",
    "expo-apple-authentication",
    [
      "expo-camera",
      {
        cameraPermission: "SFLuv uses your camera to scan payment, reward, and contact QR codes.",
        recordAudioAndroid: false,
      },
    ],
    "expo-dev-client",
    [
      "expo-location",
      {
        locationWhenInUsePermission: "SFLuv uses your location to show nearby merchants and your position on the merchant map.",
      },
    ],
    [
      "expo-image-picker",
      {
        microphonePermission: false,
        photosPermission: "SFLuv lets you choose workflow photos to submit for improver tasks.",
      },
    ],
    "expo-notifications",
    "expo-secure-store",
    "expo-web-browser",
  ],
  extra: buildExtra(config),
});

/*
 * withSentry is a config plugin, not a config wrapper — it attaches the native
 * mods that write `sentry.properties` into the generated iOS and Android
 * projects. It does not appear in the `plugins` array above; confirm it took
 * with `expo config --type prebuild` and look for @sentry/react-native in
 * _internal.pluginHistory.
 *
 * Source-map upload runs during the native release build and reads
 * SENTRY_AUTH_TOKEN from the environment — `scripts/with-local-env.sh` loads it
 * from `mobile/.env` locally, EAS from a build secret. The token is
 * deliberately never inlined here: the plugin would write it into the shipped
 * application package. Without it the upload is skipped and the build still
 * succeeds, leaving stack traces minified rather than failing outright.
 */
export default ({ config }: ConfigContext): ExpoConfig =>
  withSentry(baseConfig(config), {
    url: "https://sentry.io/",
    organization: process.env.SENTRY_ORG?.trim() || DEFAULT_SENTRY_ORG,
    project: process.env.SENTRY_PROJECT?.trim() || DEFAULT_SENTRY_PROJECT,
  });
