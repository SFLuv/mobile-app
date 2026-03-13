export type RouteID = "legacy" | "new";

export type WalletRouteConfig = {
  id: RouteID;
  label: string;
  entryPoint: string;
  accountFactory: string;
  paymasterAddress: string;
  paymasterType: "cw" | "cw-safe";
  backendURL: string;
  backendKind: "sfluv" | "cw-engine";
};

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

const parseBoolean = (value: string | undefined, fallback: boolean): boolean => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return fallback;
};

const parseBackendKind = (
  value: string | undefined,
  fallback: "sfluv" | "cw-engine",
): "sfluv" | "cw-engine" => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "sfluv") {
    return "sfluv";
  }
  if (normalized === "cw-engine") {
    return "cw-engine";
  }
  return fallback;
};

const parsePaymasterType = (value: string | undefined, fallback: "cw" | "cw-safe"): "cw" | "cw-safe" => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "cw") {
    return "cw";
  }
  if (normalized === "cw-safe" || normalized === "cwsafe") {
    return "cw-safe";
  }
  return fallback;
};

const baseBackendURL = process.env.EXPO_PUBLIC_BACKEND_URL ?? "http://localhost:8088";

const legacyRoute: WalletRouteConfig = {
  id: "legacy",
  label: "Legacy",
  entryPoint:
    process.env.EXPO_PUBLIC_LEGACY_ENTRYPOINT_ADDRESS ??
    "0x7079253c0358eF9Fd87E16488299Ef6e06F403B6",
  accountFactory:
    process.env.EXPO_PUBLIC_LEGACY_ACCOUNT_FACTORY_ADDRESS ??
    "0x7cC54D54bBFc65d1f0af7ACee5e4042654AF8185",
  paymasterAddress:
    process.env.EXPO_PUBLIC_LEGACY_PAYMASTER_ADDRESS ??
    "0x9A5be02B65f9Aa00060cB8c951dAFaBAB9B860cd",
  paymasterType: parsePaymasterType(process.env.EXPO_PUBLIC_LEGACY_PAYMASTER_TYPE, "cw-safe"),
  backendURL:
    process.env.EXPO_PUBLIC_LEGACY_BACKEND_URL ?? `https://${process.env.EXPO_PUBLIC_CHAIN_ID ?? "80094"}.engine.citizenwallet.xyz`,
  backendKind: parseBackendKind(process.env.EXPO_PUBLIC_LEGACY_BACKEND_KIND, "cw-engine"),
};

const newRoute: WalletRouteConfig = {
  id: "new",
  label: "New",
  entryPoint:
    process.env.EXPO_PUBLIC_ENTRYPOINT_ADDRESS ??
    "0x55Dea4A3e9051a4123d751Df28E9c7b14D8e7F7d",
  accountFactory:
    process.env.EXPO_PUBLIC_ACCOUNT_FACTORY_ADDRESS ?? "0x5F4C862c7F2B38D2A7f46aE950379A9678ac6185",
  paymasterAddress:
    process.env.EXPO_PUBLIC_PAYMASTER_ADDRESS ?? "0x8FF7A8b1abD5A455A86B02A9d049D6aFdB82411e",
  paymasterType: parsePaymasterType(process.env.EXPO_PUBLIC_NEW_PAYMASTER_TYPE, "cw"),
  backendURL: process.env.EXPO_PUBLIC_NEW_BACKEND_URL ?? baseBackendURL,
  backendKind: parseBackendKind(process.env.EXPO_PUBLIC_NEW_BACKEND_KIND, "sfluv"),
};

const routePriorityRaw = (process.env.EXPO_PUBLIC_ROUTE_PRIORITY ?? "legacy,new")
  .split(",")
  .map((value) => value.trim().toLowerCase())
  .filter((value) => value === "legacy" || value === "new") as RouteID[];

const routePriority = routePriorityRaw.length > 0 ? routePriorityRaw : (["legacy", "new"] as RouteID[]);

export const mobileConfig = {
  chainId: parseNumber(process.env.EXPO_PUBLIC_CHAIN_ID, 80094),
  rpcURL: process.env.EXPO_PUBLIC_RPC_URL ?? "https://rpc.berachain.com",
  tokenAddress: process.env.EXPO_PUBLIC_TOKEN_ADDRESS ?? "0x881cad4f885c6701d8481c0ed347f6d35444ea7e",
  tokenDecimals: parseNumber(process.env.EXPO_PUBLIC_TOKEN_DECIMALS, 18),
  appBackendURL: process.env.EXPO_PUBLIC_APP_BACKEND_URL ?? "http://localhost:8080",
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
  mapId: process.env.EXPO_PUBLIC_MAP_ID ?? "",

  routes: {
    legacy: legacyRoute,
    new: newRoute,
  },
  routePriority,
  forceRoute: (process.env.EXPO_PUBLIC_FORCE_ROUTE?.trim().toLowerCase() as RouteID | undefined) ?? undefined,
  preferLegacyIfDeployed: parseBoolean(process.env.EXPO_PUBLIC_PREFER_LEGACY_IF_DEPLOYED, true),
  maxSmartAccountScan: parseNumber(process.env.EXPO_PUBLIC_MAX_SMART_ACCOUNT_SCAN, 5),

  // Privy
  privyAppId: process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "",
  privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? "",

  // Temporary fallback for local testing where Privy is not configured.
  testOwnerPrivateKey: process.env.EXPO_PUBLIC_TEST_OWNER_PRIVATE_KEY ?? "",
};
