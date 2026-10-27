import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

const DEFAULT_EAS_PROJECT_ID = "457c71a1-29cd-4e60-9be8-04a6e0a6194a";
const DEFAULT_EXPO_OWNER = "sfluv";
const DEFAULT_EXPO_SLUG = "sfluv";
const DEFAULT_IOS_BUNDLE_IDENTIFIER = "org.sfluv.wallet";
const DEFAULT_ANDROID_PACKAGE = "org.sfluv.wallet";

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

function resolveEasProjectId(config: ConfigContext["config"]): string {
  const extraEas = (config.extra as { eas?: { projectId?: unknown } } | undefined)?.eas;
  const existingProjectId = typeof extraEas?.projectId === "string" ? extraEas.projectId : undefined;
  return process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || existingProjectId || DEFAULT_EAS_PROJECT_ID;
}

const googleServicesFile = resolveGoogleServicesFile();
const expoOwner = process.env.EXPO_OWNER?.trim() || DEFAULT_EXPO_OWNER;
const expoSlug = process.env.EXPO_SLUG?.trim() || DEFAULT_EXPO_SLUG;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "SFLuv",
  slug: expoSlug,
  owner: expoOwner,
  // 2.2.0, and the bump is load-bearing rather than ceremonial.
  //
  // runtimeVersion below is `policy: "appVersion"`, so THIS STRING is the
  // over-the-air compatibility boundary: an update is delivered to any build on
  // the same channel whose runtime version matches. 2.2 adds a native module
  // (expo-document-picker, for chat file attachments) which the 2.1 build in
  // the store does not have, and expo-document-picker throws at import when its
  // native side is missing — so an update left on 2.1.0 would be shipped to
  // 2.1 installs and stop them booting.
  //
  // Leaving this at 2.1.0 for a release that adds native code is therefore not
  // an untidy version number; it is a way to brick the installed base.
  version: "2.2.0",
  description:
    "This app is a nonprofit-run community hub for managing and spending your SFLUV, redeeming perks, and coordinating verified improvers. Improvers can sign up to complete real-world tasks in San Francisco and be rewarded with SFLUV.",
  scheme: "sfluv",
  // Over-the-air updates. A JavaScript-only fix ships with `eas update` in
  // minutes, without store review.
  //
  // ── What this policy does and does not guarantee ───────────────────────────
  //
  // This comment used to say the *fingerprint* policy was in use and that "an
  // update can never reach a build whose native side it does not match". The
  // policy is `appVersion`, which does not provide that: it matches on the
  // `version` string above and nothing else, so two builds with different
  // native code and the same version string are treated as interchangeable.
  //
  // The safety property therefore rests on discipline — bump `version` whenever
  // native code changes — and that discipline is now written next to `version`
  // itself, where somebody about to edit it will see it.
  //
  // `policy: "fingerprint"` would make it structural instead: it hashes the
  // native project, so adding a package changes the runtime version
  // automatically and a mismatched update becomes undeliverable rather than
  // merely discouraged. That is almost certainly what was intended here. It is
  // left as a deliberate decision rather than changed in passing, because it
  // alters which builds a hotfix can reach.
  runtimeVersion: { policy: "appVersion" },
  updates: {
    url: `https://u.expo.dev/${resolveEasProjectId(config)}`,
    // Download in the background on launch and apply on the next one, so a
    // slow network never holds up opening the app.
    checkAutomatically: "ON_LOAD",
    fallbackToCacheTimeout: 0,
  },
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
    "expo-updates",
    "expo-web-browser",
  ],
  extra: buildExtra(config),
});
