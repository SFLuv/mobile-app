export type WalletConfig = {
  entryPoint: string;
  accountFactory: string;
  paymasterAddress: string;
  paymasterType: "cw-safe";
  backendURL: string;
  backendKind: "cw-engine";
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

const parsePaymasterType = (value: string | undefined, fallback: "cw-safe"): "cw-safe" => {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "cw-safe" || normalized === "cwsafe") {
    return "cw-safe";
  }
  return fallback;
};

const appBackendURL = process.env.EXPO_PUBLIC_APP_BACKEND_URL ?? "http://localhost:8080";
const legacyWalletConfig: WalletConfig = {
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
  backendKind: "cw-engine",
};

export const mobileConfig = {
  chainId: parseNumber(process.env.EXPO_PUBLIC_CHAIN_ID, 80094),
  rpcURL: process.env.EXPO_PUBLIC_RPC_URL ?? "https://rpc.berachain.com",
  tokenAddress: process.env.EXPO_PUBLIC_TOKEN_ADDRESS ?? "0x881cad4f885c6701d8481c0ed347f6d35444ea7e",
  tokenDecimals: parseNumber(process.env.EXPO_PUBLIC_TOKEN_DECIMALS, 18),
  adminAddress:
    process.env.EXPO_PUBLIC_ADMIN_ADDRESS ?? "0x05e2Fb34b4548990F96B3ba422eA3EF49D5dAa99",
  appBackendURL,
  appOrigin: process.env.EXPO_PUBLIC_APP_ORIGIN ?? "https://app.sfluv.org",
  googleMapsApiKey: process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? "",
  mapId: process.env.EXPO_PUBLIC_MAP_ID ?? "",
  expoProjectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID ?? "",

  wallet: legacyWalletConfig,
  maxSmartAccountScan: parseNumber(process.env.EXPO_PUBLIC_MAX_SMART_ACCOUNT_SCAN, 5),

  // Privy
  privyAppId: process.env.EXPO_PUBLIC_PRIVY_APP_ID ?? "",
  privyClientId: process.env.EXPO_PUBLIC_PRIVY_CLIENT_ID ?? "",
};
