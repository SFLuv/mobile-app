import fs from "node:fs";
import path from "node:path";
import { withSentry } from "@sentry/react-native/expo";
import type { ConfigContext, ExpoConfig } from "expo/config";

const DEFAULT_EAS_PROJECT_ID = "457c71a1-29cd-4e60-9be8-04a6e0a6194a";
const DEFAULT_EXPO_OWNER = "sfluv";
const DEFAULT_EXPO_SLUG = "sfluv";
const DEFAULT_IOS_BUNDLE_IDENTIFIER = "org.sfluv.wallet";
const DEFAULT_ANDROID_PACKAGE = "org.sfluv.wallet";
const DEFAULT_APPLE_TEAM_ID = "ARLC5L6F5P";
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

function resolveEasProjectId(config: ConfigContext["config"]): string {
  const extraEas = (config.extra as { eas?: { projectId?: unknown } } | undefined)?.eas;
  const existingProjectId = typeof extraEas?.projectId === "string" ? extraEas.projectId : undefined;
  return process.env.EXPO_PUBLIC_EAS_PROJECT_ID?.trim() || existingProjectId || DEFAULT_EAS_PROJECT_ID;
}

const googleServicesFile = resolveGoogleServicesFile();
const expoOwner = process.env.EXPO_OWNER?.trim() || DEFAULT_EXPO_OWNER;
const expoSlug = process.env.EXPO_SLUG?.trim() || DEFAULT_EXPO_SLUG;

const baseConfig = (config: ConfigContext["config"]): ExpoConfig => ({
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
  //
  // 2.3.0 for the same reason: it adds a share extension (expo-share-intent,
  // whose JS calls a native module 2.2 does not have) and a Notification
  // Service Extension. JS that imports the share module, delivered over the
  // air to a 2.2 binary, would fail at import.
  //
  // 2.4.0: the composer's text field is now a native component
  // (@mattermost/react-native-paste-input, so its own Paste can take photos and
  // files). JS rendering it on a 2.3 binary would draw an unimplemented view
  // where the message field should be. No new extension or entitlement this
  // time, so no Apple-portal work comes with it.
  version: "2.4.0",
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
    // Required by @bacons/apple-targets to sign the extension targets. The
    // same team the universal-link association file names.
    appleTeamId: process.env.APPLE_TEAM_ID?.trim() || DEFAULT_APPLE_TEAM_ID,
    usesAppleSignIn: true,
    entitlements: {
      // Lets the Notification Service Extension present chat pushes as
      // communication notifications: the sender's picture, the app's icon in
      // the corner. See targets/notification-service.
      "com.apple.developer.usernotifications.communication": true,
    },
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "",
    },
    associatedDomains: ["applinks:app.sfluv.org"],
    infoPlist: {
      CFBundleDisplayName: "SFLuv",
      ITSAppUsesNonExemptEncryption: false,
      // Declares that the app donates messaging intents, which iOS requires
      // before it will draw a communication notification.
      NSUserActivityTypes: ["INSendMessageIntent"],
    },
  },
  android: {
    package: process.env.ANDROID_PACKAGE?.trim() || DEFAULT_ANDROID_PACKAGE,
    // Google Play only lets gallery-type apps hold broad photo, video and
    // audio library access, and rejected 2.4.0 for declaring it. Nothing here
    // needs it: picking photos uses the system photo picker, and saving a chat
    // image asks for add-only access (attachmentFiles.ts). expo-media-library
    // adds these by default, so they are stripped from the final manifest.
    blockedPermissions: [
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.READ_MEDIA_AUDIO",
      "android.permission.READ_MEDIA_VISUAL_USER_SELECTED",
    ],
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
    // Builds targets/* into the iOS project — the Notification Service
    // Extension. Listed before expo-share-intent: both register EAS app
    // extensions, and expo-share-intent mishandles its own entry when it lands
    // at index 0 of that list.
    // The composer's native paste — see plugins/withPasteInput.js.
    "./plugins/withPasteInput",
    "@bacons/apple-targets",
    [
      "expo-share-intent",
      {
        // "SFLuv" in the share sheet. The target name is set separately — a
        // patched option, see patches/expo-share-intent+5.1.1.patch — because
        // by default the label is also the Xcode target name, and "SFLuv"
        // collides with the app's own target and the extension is skipped.
        iosShareExtensionName: "SFLuv",
        iosShareExtensionTargetName: "ShareExtension",
        // One item at a time: with several, the extension hands off to the
        // app when the LAST one finishes loading and can drop the rest.
        iosActivationRules: {
          NSExtensionActivationSupportsText: true,
          NSExtensionActivationSupportsWebURLWithMaxCount: 1,
          NSExtensionActivationSupportsWebPageWithMaxCount: 1,
          NSExtensionActivationSupportsImageWithMaxCount: 1,
          NSExtensionActivationSupportsFileWithMaxCount: 1,
        },
        androidIntentFilters: ["text/*", "image/*", "*/*"],
      },
    ],
  ],
  extra: buildExtra(config),
});

/*
 * withSentry is a config plugin, not a config wrapper: it attaches the native
 * mods that write `sentry.properties` and the source-map upload step into the
 * generated iOS and Android projects. It does not appear in `plugins` above;
 * `expo config --type prebuild` lists it under _internal.pluginHistory.
 *
 * The upload reads SENTRY_AUTH_TOKEN from the environment: `mobile/.env`
 * locally, an EAS secret in the cloud. It is deliberately never inlined here,
 * because the plugin writes its options into the shipped app. Without it the
 * build still succeeds and stack traces stay minified.
 */
export default ({ config }: ConfigContext): ExpoConfig =>
  withSentry(baseConfig(config), {
    url: "https://sentry.io/",
    organization: process.env.SENTRY_ORG?.trim() || DEFAULT_SENTRY_ORG,
    project: process.env.SENTRY_PROJECT?.trim() || DEFAULT_SENTRY_PROJECT,
  });
