const parseNumber = (value: string | undefined, fallback: number): number => {
  if (!value) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return parsed;
};

const appBackendURL = process.env.EXPO_PUBLIC_APP_BACKEND_URL ?? "http://localhost:8080";

export const mobileConfig = {
  adminAddress:
    process.env.EXPO_PUBLIC_ADMIN_ADDRESS ?? "0x05e2Fb34b4548990F96B3ba422eA3EF49D5dAa99",
  appBackendURL,
  appOrigin: process.env.EXPO_PUBLIC_APP_ORIGIN ?? "https://app.sfluv.org",
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
  mapId: process.env.EXPO_PUBLIC_MAP_ID ?? "",
  expoProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "",
  maxSmartAccountScan: parseNumber(process.env.EXPO_PUBLIC_MAX_SMART_ACCOUNT_SCAN, 5),

  // Privy
  privyAppId: process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "",
  privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? "",

  /*
   * Sentry. The DSN is public by design — it ships inside the client bundle and
   * only permits submitting events, never reading them, so it belongs here with
   * the other EXPO_PUBLIC_ values. An empty DSN disables Sentry outright, which
   * is what local Expo Go runs should do.
   *
   * SENTRY_AUTH_TOKEN is the real credential and is deliberately absent: it is
   * build-time only and must never reach the client bundle.
   */
  sentryDsn: process.env.EXPO_PUBLIC_SENTRY_DSN ?? "",
  sentryEnvironment: process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT ?? "development",
};
