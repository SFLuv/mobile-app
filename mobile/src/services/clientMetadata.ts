import * as Application from "expo-application";
import Constants from "expo-constants";
import { Platform } from "react-native";

export type ClientPlatform = "ios" | "android" | "web" | "unknown";

export type ClientMetadata = {
  platform: ClientPlatform;
  version: string;
  build: number;
  buildLabel: string;
};

function parseBuild(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function platform(): ClientPlatform {
  if (Platform.OS === "ios" || Platform.OS === "android" || Platform.OS === "web") {
    return Platform.OS;
  }
  return "unknown";
}

export function getClientMetadata(): ClientMetadata {
  const buildLabel =
    Application.nativeBuildVersion ??
    Constants.expoConfig?.ios?.buildNumber ??
    String(Constants.expoConfig?.android?.versionCode ?? "");

  return {
    platform: platform(),
    version: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? "0.0.0",
    build: parseBuild(buildLabel),
    buildLabel: buildLabel || "0",
  };
}

export function clientMetadataHeaders(): Record<string, string> {
  const metadata = getClientMetadata();
  return {
    "X-SFLUV-Client-Platform": metadata.platform,
    "X-SFLUV-Client-Version": metadata.version,
    "X-SFLUV-Client-Build": metadata.buildLabel,
  };
}
