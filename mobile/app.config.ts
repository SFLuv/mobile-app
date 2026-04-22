import fs from "node:fs";
import path from "node:path";
import type { ConfigContext, ExpoConfig } from "expo/config";

const DEFAULT_EAS_PROJECT_ID = "ee7c9c8e-f237-44cf-917c-ee424401e299";
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

const googleServicesFile = resolveGoogleServicesFile();

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: "SFLUV Wallet",
  slug: "sfluv-wallet",
  owner: "sanchez0",
  version: "0.1.0",
  scheme: "sfluvwallet",
  orientation: "portrait",
  icon: "./assets/icon.png",
  userInterfaceStyle: "light",
  ios: {
    supportsTablet: false,
    bundleIdentifier: process.env.IOS_BUNDLE_IDENTIFIER?.trim() || DEFAULT_IOS_BUNDLE_IDENTIFIER,
    usesAppleSignIn: true,
    config: {
      googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY?.trim() || "",
    },
    associatedDomains: ["applinks:app.sfluv.org"],
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    package: DEFAULT_ANDROID_PACKAGE,
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
        cameraPermission: "SFLUV Wallet uses your camera to scan payment, reward, and contact QR codes.",
        recordAudioAndroid: false,
      },
    ],
    "expo-dev-client",
    [
      "expo-location",
      {
        locationWhenInUsePermission: "SFLUV Wallet uses your location to show nearby merchants and your position on the merchant map.",
      },
    ],
    "expo-notifications",
    "expo-secure-store",
    "expo-web-browser",
  ],
  extra: buildExtra(config),
});
