import { ethers } from "ethers";
import { Buffer } from "buffer";
import { mobileConfig } from "../config";
import { AmountUnit } from "../services/smartWallet";
import { parseTransferQR } from "./qr";

export type SfluvUniversalLink =
  | {
      type: "pay";
      address: string;
      href: string;
    }
  | {
      type: "addcontact";
      address: string;
      href: string;
    }
  | {
      type: "redeem";
      code: string;
      href: string;
    }
  | {
      type: "request";
      address: string;
      amount?: string;
      memo?: string;
      tipToAddress?: string;
      href: string;
    };

export type SendTarget = {
  recipient: string;
  amount?: string;
  memo?: string;
  tipToAddress?: string;
  source?: "sfluv-link" | "citizenwallet-link" | "citizenwallet-plugin-link" | "transfer-qr";
  amountUnit: AmountUnit;
};

const UUID_EXACT_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const UUID_IN_TEXT_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i;

function aliasHost(): string {
  try {
    return new URL(normalizeOrigin(mobileConfig.appOrigin)).host;
  } catch {
    return "wallet.berachain.sfluv.org";
  }
}

function normalizeBase64Url(rawValue: string): string {
  const normalized = rawValue.trim().replace(/-/g, "+").replace(/_/g, "/");
  const padLength = (4 - (normalized.length % 4)) % 4;
  return `${normalized}${"=".repeat(padLength)}`;
}

function decodeBase64Address(rawValue: string | null): string | undefined {
  if (!rawValue) {
    return undefined;
  }

  try {
    const decoded = Buffer.from(normalizeBase64Url(rawValue), "base64");
    if (decoded.length !== 20) {
      return undefined;
    }
    return ethers.utils.getAddress(`0x${decoded.toString("hex")}`);
  } catch {
    return undefined;
  }
}

function parseQueryLikeString(rawValue: string): URLSearchParams {
  const trimmed = rawValue.trim().replace(/^[#?]+/, "");
  const withoutLeadingSlash = trimmed.startsWith("/") ? trimmed.slice(1) : trimmed;
  const query = withoutLeadingSlash.startsWith("?") ? withoutLeadingSlash.slice(1) : withoutLeadingSlash;
  const questionMarkIndex = query.indexOf("?");
  return new URLSearchParams(questionMarkIndex >= 0 ? query.slice(questionMarkIndex + 1) : query);
}

function safeDecodeURIComponent(rawValue: string): string {
  try {
    return decodeURIComponent(rawValue);
  } catch {
    return rawValue;
  }
}

function getParam(params: URLSearchParams, ...keys: string[]): string | null {
  for (const key of keys) {
    const directValue = params.get(key);
    if (directValue !== null) {
      return directValue;
    }
  }

  const normalizedKeys = new Set(keys.map((key) => key.toLowerCase()));
  for (const [key, value] of params.entries()) {
    if (normalizedKeys.has(key.toLowerCase())) {
      return value;
    }
  }

  return null;
}

function collectParamsFromURL(parsedURL: URL): URLSearchParams[] {
  const candidates = [parsedURL.searchParams];
  if (parsedURL.hash) {
    candidates.push(parseQueryLikeString(parsedURL.hash));
  }
  return candidates.filter((params) => params.toString().length > 0);
}

function normalizeAddressParam(rawValue: string | null | undefined): string | undefined {
  if (!rawValue) {
    return undefined;
  }
  const decoded = safeDecodeURIComponent(rawValue).trim();
  if (ethers.utils.isAddress(decoded)) {
    return ethers.utils.getAddress(decoded);
  }
  return undefined;
}

function resolveAddressFromParams(
  params: URLSearchParams,
  primaryKey: string,
  shortKey: string,
  sendToKey?: string,
): string | undefined {
  if (sendToKey) {
    const sendToValue = getParam(params, sendToKey);
    if (sendToValue) {
      const [rawAddress] = safeDecodeURIComponent(sendToValue).split("@");
      const address = normalizeAddressParam(rawAddress);
      if (address) {
        return address;
      }
    }
  }

  const direct = normalizeAddressParam(getParam(params, primaryKey));
  if (direct) {
    return direct;
  }

  const shortValue = getParam(params, shortKey)?.trim();
  if (!shortValue) {
    return undefined;
  }

  const decoded = decodeBase64Address(shortValue);
  if (decoded) {
    return decoded;
  }
  return normalizeAddressParam(shortValue);
}

function normalizeRedeemCode(rawCode: string | null | undefined): string | undefined {
  if (!rawCode) {
    return undefined;
  }

  let code = rawCode.trim();
  if (!code) {
    return undefined;
  }

  try {
    code = decodeURIComponent(code);
  } catch {
    // keep the raw value when percent-decoding fails
  }

  code = code.replace(/\s+/g, "");

  if (UUID_EXACT_PATTERN.test(code)) {
    return code.toLowerCase();
  }

  const trailingTrimmed = code.endsWith("26") ? code.slice(0, -2) : "";
  if (trailingTrimmed && UUID_EXACT_PATTERN.test(trailingTrimmed)) {
    return trailingTrimmed.toLowerCase();
  }

  const uuidMatch = code.match(UUID_IN_TEXT_PATTERN);
  if (uuidMatch) {
    return uuidMatch[0].toLowerCase();
  }

  return code.toLowerCase();
}

function extractRedeemCodeFromAppUrl(parsedURL: URL, configuredURL: URL): string | undefined {
  if (parsedURL.protocol !== "https:" || parsedURL.host.toLowerCase() !== configuredURL.host.toLowerCase()) {
    return undefined;
  }

  const pathSegments = parsedURL.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .map((segment) => segment.toLowerCase());
  const hasLegacyRedeemQuery = parsedURL.searchParams.get("page")?.trim().toLowerCase() === "redeem";
  const hasFaucetRedeemPath = pathSegments.length >= 2 && pathSegments[0] === "faucet" && pathSegments[1] === "redeem";

  if (!hasLegacyRedeemQuery && !hasFaucetRedeemPath) {
    return undefined;
  }

  return normalizeRedeemCode(parsedURL.searchParams.get("code"));
}

function parseCitizenWalletPluginRedeemLink(rawValue: string, configuredURL: URL): SfluvUniversalLink | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  let outerURL: URL;
  try {
    outerURL = new URL(trimmed);
  } catch {
    return null;
  }

  const outerParams = outerURL.hash ? parseQueryLikeString(outerURL.hash) : outerURL.searchParams;
  const pluginValue = getParam(outerParams, "plugin");
  if (!pluginValue) {
    return null;
  }

  let innerURL: URL;
  try {
    innerURL = new URL(decodeURIComponent(pluginValue));
  } catch {
    return null;
  }

  const code = extractRedeemCodeFromAppUrl(innerURL, configuredURL);
  if (!code) {
    return null;
  }

  return {
    type: "redeem",
    code,
    href: trimmed,
  };
}

function parseCitizenWalletPluginLink(rawValue: string): SendTarget | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  let outerURL: URL;
  try {
    outerURL = new URL(trimmed);
  } catch {
    return null;
  }

  const outerParams = outerURL.hash ? parseQueryLikeString(outerURL.hash) : outerURL.searchParams;
  const pluginValue = getParam(outerParams, "plugin");
  if (!pluginValue) {
    return null;
  }

  let innerURL: URL;
  try {
    innerURL = new URL(decodeURIComponent(pluginValue));
  } catch {
    return null;
  }

  const recipient = decodeBase64Address(getParam(innerURL.searchParams, "t"));
  if (!recipient) {
    return null;
  }

  const tipToAddress = decodeBase64Address(getParam(innerURL.searchParams, "tt"));

  return {
    recipient,
    tipToAddress: tipToAddress && tipToAddress.toLowerCase() !== recipient.toLowerCase() ? tipToAddress : undefined,
    amountUnit: "token",
    source: "citizenwallet-plugin-link",
  };
}

function parseCitizenWalletMerchantSendLink(rawValue: string): SendTarget | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  const candidates: URLSearchParams[] = [];
  const collectFromRaw = (value: string) => {
    try {
      candidates.push(...collectParamsFromURL(new URL(value)));
      return;
    } catch {
      // Fall through to query-string parsing.
    }

    const queryLike = value.trim().replace(/^[#?]+/, "");
    if (queryLike.includes("=")) {
      try {
        candidates.push(new URLSearchParams(queryLike));
      } catch {
        // Ignore malformed query text.
      }
    }
  };

  collectFromRaw(trimmed);
  const decoded = safeDecodeURIComponent(trimmed);
  if (decoded !== trimmed) {
    collectFromRaw(decoded);
  }

  for (const params of candidates) {
    const sendToValue = getParam(params, "sendto", "sendTo") || "";
    const mode = (getParam(params, "p", "m", "mode") || "").trim().toLowerCase();
    const recipient = resolveAddressFromParams(params, "to", "t", "sendto");
    const hasSendIntent =
      Boolean(sendToValue) ||
      Boolean(getParam(params, "to", "t")) ||
      mode === "r" ||
      mode === "s" ||
      mode === "send";
    if (!hasSendIntent || !recipient) {
      continue;
    }

    const tipToAddress = resolveAddressFromParams(params, "tipTo", "tt");
    const amount = normalizeRequestAmount(getParam(params, "amount"));
    const memo = getParam(params, "memo", "message")?.trim() || undefined;

    return {
      recipient,
      amount,
      memo,
      tipToAddress,
      amountUnit: "token",
      source: "citizenwallet-link",
    };
  }

  return null;
}

function parseCitizenWalletRequestLink(rawValue: string): SendTarget | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  let parsedURL: URL;
  let configuredURL: URL;
  try {
    parsedURL = new URL(trimmed);
    configuredURL = new URL(normalizeOrigin(mobileConfig.appOrigin));
  } catch {
    return null;
  }

  if (parsedURL.protocol !== "https:" || parsedURL.host.toLowerCase() !== configuredURL.host.toLowerCase()) {
    return null;
  }

  const mode = getParam(parsedURL.searchParams, "p")?.trim().toLowerCase();
  if (mode !== "r") {
    return null;
  }

  const sendToValue = getParam(parsedURL.searchParams, "sendto", "sendTo")?.trim();
  if (!sendToValue) {
    return null;
  }

  const [rawRecipient] = safeDecodeURIComponent(sendToValue).split("@");
  if (!rawRecipient || !ethers.utils.isAddress(rawRecipient)) {
    return null;
  }

  const recipient = ethers.utils.getAddress(rawRecipient);
  const rawTipTo = getParam(parsedURL.searchParams, "tipTo", "tt")?.trim();
  const tipToAddress =
    rawTipTo && ethers.utils.isAddress(rawTipTo)
      ? ethers.utils.getAddress(rawTipTo)
      : undefined;
  const amount = normalizeRequestAmount(getParam(parsedURL.searchParams, "amount"));
  const memo = getParam(parsedURL.searchParams, "memo", "message")?.trim() || undefined;

  return {
    recipient,
    amount,
    memo,
    tipToAddress,
    amountUnit: "token",
    source: "sfluv-link",
  };
}

function parseHostedRequestLink(rawValue: string): Extract<SfluvUniversalLink, { type: "request" }> | null {
  const parsed = parseCitizenWalletRequestLink(rawValue);
  if (!parsed) {
    return null;
  }

  return {
    type: "request",
    address: parsed.recipient,
    amount: parsed.amount,
    memo: parsed.memo,
    tipToAddress: parsed.tipToAddress,
    href: rawValue.trim(),
  };
}

function normalizeOrigin(rawOrigin: string): string {
  return rawOrigin.trim().replace(/\/+$/, "");
}

function normalizeRequestAmount(rawValue: string | null): string | undefined {
  if (!rawValue) {
    return undefined;
  }
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return undefined;
  }
  try {
    ethers.utils.parseUnits(trimmed, mobileConfig.tokenDecimals);
    return trimmed;
  } catch {
    return undefined;
  }
}

export function buildUniversalRequestLink(input: {
  address: string;
  amount?: string;
  memo?: string;
  tipToAddress?: string;
}): string {
  const url = new URL(`${normalizeOrigin(mobileConfig.appOrigin)}/map`);
  url.searchParams.set("p", "r");
  url.searchParams.set("alias", aliasHost());
  url.searchParams.set("sendto", `${ethers.utils.getAddress(input.address)}@${aliasHost()}`);
  const tipToAddress = input.tipToAddress?.trim();
  if (tipToAddress && ethers.utils.isAddress(tipToAddress) && tipToAddress.toLowerCase() !== input.address.toLowerCase()) {
    url.searchParams.set("tipTo", ethers.utils.getAddress(tipToAddress));
  }
  const amount = input.amount?.trim();
  if (amount) {
    url.searchParams.set("amount", amount);
  }
  const memo = input.memo?.trim();
  if (memo) {
    url.searchParams.set("memo", memo);
  }
  return url.toString();
}

export function buildUniversalPayLink(input: {
  address: string;
}): string {
  return `${normalizeOrigin(mobileConfig.appOrigin)}/pay/${ethers.utils.getAddress(input.address)}`;
}

export function buildUniversalAddContactLink(input: {
  address: string;
}): string {
  return `${normalizeOrigin(mobileConfig.appOrigin)}/addcontact/${ethers.utils.getAddress(input.address)}`;
}

export function parseSfluvUniversalLink(rawValue: string): SfluvUniversalLink | null {
  const trimmed = rawValue.trim();
  if (!trimmed) {
    return null;
  }

  let parsedURL: URL;
  let configuredURL: URL;
  try {
    parsedURL = new URL(trimmed);
    configuredURL = new URL(normalizeOrigin(mobileConfig.appOrigin));
  } catch {
    return null;
  }

  const citizenWalletPluginRedeem = parseCitizenWalletPluginRedeemLink(trimmed, configuredURL);
  if (citizenWalletPluginRedeem) {
    return citizenWalletPluginRedeem;
  }

  const legacyRedeemCode = extractRedeemCodeFromAppUrl(parsedURL, configuredURL);
  if (legacyRedeemCode) {
    return {
      type: "redeem",
      code: legacyRedeemCode,
      href: trimmed,
    };
  }

  const hostedRequestLink = parseHostedRequestLink(trimmed);
  if (hostedRequestLink) {
    return hostedRequestLink;
  }

  if (parsedURL.protocol !== "https:" || parsedURL.host.toLowerCase() !== configuredURL.host.toLowerCase()) {
    return null;
  }

  const segments = parsedURL.pathname
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (segments.length < 2) {
    return null;
  }

  const action = segments[0]?.toLowerCase();
  const rawParam = decodeURIComponent(segments.slice(1).join("/")).trim();
  if (!rawParam) {
    return null;
  }

  if (action === "pay") {
    if (!ethers.utils.isAddress(rawParam)) {
      return null;
    }
    return {
      type: "pay",
      address: ethers.utils.getAddress(rawParam),
      href: trimmed,
    };
  }

  if (action === "addcontact") {
    if (!ethers.utils.isAddress(rawParam)) {
      return null;
    }
    return {
      type: "addcontact",
      address: ethers.utils.getAddress(rawParam),
      href: trimmed,
    };
  }

  if (action === "request") {
    if (!ethers.utils.isAddress(rawParam)) {
      return null;
    }
    return {
      type: "request",
      address: ethers.utils.getAddress(rawParam),
      amount: normalizeRequestAmount(getParam(parsedURL.searchParams, "amount")),
      memo: getParam(parsedURL.searchParams, "memo", "message")?.trim() || undefined,
      tipToAddress: resolveAddressFromParams(parsedURL.searchParams, "tipTo", "tt"),
      href: trimmed,
    };
  }

  if (action === "redeem") {
    return {
      type: "redeem",
      code: rawParam,
      href: trimmed,
    };
  }

  return null;
}

export function parseSendTarget(rawValue: string): SendTarget | null {
  const universalLink = parseSfluvUniversalLink(rawValue);
  if (universalLink?.type === "pay") {
    return {
      recipient: universalLink.address,
      amountUnit: "token",
      source: "sfluv-link",
    };
  }
  if (universalLink?.type === "request") {
    return {
      recipient: universalLink.address,
      amount: universalLink.amount,
      memo: universalLink.memo,
      tipToAddress: universalLink.tipToAddress,
      amountUnit: "token",
      source: "sfluv-link",
    };
  }
  if (universalLink?.type === "redeem") {
    return null;
  }
  if (universalLink?.type === "addcontact") {
    return null;
  }

  const citizenWalletRequestLink = parseCitizenWalletRequestLink(rawValue);
  if (citizenWalletRequestLink) {
    return citizenWalletRequestLink;
  }

  const citizenWalletMerchantSendLink = parseCitizenWalletMerchantSendLink(rawValue);
  if (citizenWalletMerchantSendLink) {
    return citizenWalletMerchantSendLink;
  }

  const citizenWalletPluginLink = parseCitizenWalletPluginLink(rawValue);
  if (citizenWalletPluginLink) {
    return citizenWalletPluginLink;
  }

  const transferQR = parseTransferQR(rawValue);
  if (!transferQR) {
    return null;
  }

  return {
    recipient: transferQR.recipient,
    amount: transferQR.amount,
    memo: transferQR.memo,
    amountUnit: transferQR.amount ? "wei" : "token",
    source: "transfer-qr",
  };
}
