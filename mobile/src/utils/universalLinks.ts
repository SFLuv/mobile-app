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
      type: "redeem";
      code: string;
      href: string;
    }
  | {
      type: "request";
      address: string;
      amount?: string;
      memo?: string;
      href: string;
    };

export type SendTarget = {
  recipient: string;
  amount?: string;
  memo?: string;
  tipToAddress?: string;
  source?: "sfluv-link" | "citizenwallet-plugin-link" | "transfer-qr";
  amountUnit: AmountUnit;
};

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
  const pluginValue = outerParams.get("plugin");
  if (!pluginValue) {
    return null;
  }

  let innerURL: URL;
  try {
    innerURL = new URL(decodeURIComponent(pluginValue));
  } catch {
    return null;
  }

  const recipient = decodeBase64Address(innerURL.searchParams.get("t"));
  if (!recipient) {
    return null;
  }

  const tipToAddress = decodeBase64Address(innerURL.searchParams.get("tt"));

  return {
    recipient,
    tipToAddress: tipToAddress && tipToAddress.toLowerCase() !== recipient.toLowerCase() ? tipToAddress : undefined,
    amountUnit: "token",
    source: "citizenwallet-plugin-link",
  };
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

  const mode = parsedURL.searchParams.get("p")?.trim().toLowerCase();
  if (mode !== "r") {
    return null;
  }

  const sendToValue = parsedURL.searchParams.get("sendto")?.trim();
  if (!sendToValue) {
    return null;
  }

  const [rawRecipient] = decodeURIComponent(sendToValue).split("@");
  if (!rawRecipient || !ethers.utils.isAddress(rawRecipient)) {
    return null;
  }

  const recipient = ethers.utils.getAddress(rawRecipient);
  const rawTipTo = parsedURL.searchParams.get("tipTo")?.trim();
  const tipToAddress =
    rawTipTo && ethers.utils.isAddress(rawTipTo) && rawTipTo.toLowerCase() !== recipient.toLowerCase()
      ? ethers.utils.getAddress(rawTipTo)
      : undefined;
  const amount = normalizeRequestAmount(parsedURL.searchParams.get("amount"));
  const memo = parsedURL.searchParams.get("memo")?.trim() || undefined;

  return {
    recipient,
    amount,
    memo,
    tipToAddress,
    amountUnit: "token",
    source: "sfluv-link",
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

  if (action === "request") {
    if (!ethers.utils.isAddress(rawParam)) {
      return null;
    }
    return {
      type: "request",
      address: ethers.utils.getAddress(rawParam),
      amount: normalizeRequestAmount(parsedURL.searchParams.get("amount")),
      memo: parsedURL.searchParams.get("memo")?.trim() || undefined,
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
      amountUnit: "token",
      source: "sfluv-link",
    };
  }
  if (universalLink?.type === "redeem") {
    return null;
  }

  const citizenWalletRequestLink = parseCitizenWalletRequestLink(rawValue);
  if (citizenWalletRequestLink) {
    return citizenWalletRequestLink;
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
