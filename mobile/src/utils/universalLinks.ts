import { ethers } from "ethers";
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
  amountUnit: AmountUnit;
};

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
}): string {
  const url = new URL(`${normalizeOrigin(mobileConfig.appOrigin)}/request/${ethers.utils.getAddress(input.address)}`);
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
    };
  }
  if (universalLink?.type === "request") {
    return {
      recipient: universalLink.address,
      amount: universalLink.amount,
      memo: universalLink.memo,
      amountUnit: "token",
    };
  }
  if (universalLink?.type === "redeem") {
    return null;
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
  };
}
