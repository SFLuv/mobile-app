import { AppContact, AppLocation, AppTransaction } from "../types/app";

export type TransactionDetailPayload = {
  transaction: AppTransaction;
  fromLabel: string;
  toLabel: string;
  received: boolean;
  typeLabel: string;
  statusLabel: string;
};

export function shortAddress(address: string, leading = 6, trailing = 4): string {
  if (!address) {
    return "";
  }
  const minimumLength = leading + trailing + 3;
  if (address.length <= minimumLength) {
    return address;
  }
  return `${address.slice(0, leading)}...${address.slice(-trailing)}`;
}

function normalizeAddress(address?: string): string {
  return address?.trim().toLowerCase() || "";
}

export function isRewardTransaction(transaction: AppTransaction, faucetAddress?: string): boolean {
  const normalizedFaucet = normalizeAddress(faucetAddress);
  return Boolean(normalizedFaucet) && transaction.direction !== "send" && normalizeAddress(transaction.from) === normalizedFaucet;
}

export function buildAddressNameMaps(
  contacts: AppContact[],
  merchants: AppLocation[],
  merchantLabels: Record<string, string>,
): {
  contactNameByAddress: Record<string, string>;
  merchantNameByAddress: Record<string, string>;
} {
  const contactNameByAddress: Record<string, string> = {};
  for (const contact of contacts) {
    contactNameByAddress[contact.address.toLowerCase()] = contact.name;
  }

  const merchantNameByAddress: Record<string, string> = { ...merchantLabels };
  for (const merchant of merchants) {
    if (!merchant.payToAddress) {
      continue;
    }
    const normalizedAddress = merchant.payToAddress.toLowerCase();
    if (!merchantNameByAddress[normalizedAddress]) {
      merchantNameByAddress[normalizedAddress] = merchant.name.trim();
    }
  }

  return { contactNameByAddress, merchantNameByAddress };
}

export function resolveAddressLabel(
  address: string,
  activeAddress: string,
  contactNameByAddress: Record<string, string>,
  merchantNameByAddress: Record<string, string>,
  faucetAddress?: string,
): string {
  const normalizedAddress = address.toLowerCase();
  if (activeAddress && normalizedAddress === activeAddress.toLowerCase()) {
    return "You";
  }
  const normalizedFaucet = normalizeAddress(faucetAddress);
  if (normalizedFaucet && normalizedAddress === normalizedFaucet) {
    return "SFLUV Faucet";
  }
  const contactName = contactNameByAddress[normalizedAddress];
  if (contactName) {
    return contactName;
  }
  const merchantName = merchantNameByAddress[normalizedAddress];
  if (merchantName) {
    return merchantName;
  }
  return shortAddress(address);
}

export function buildTransactionDetailPayload(
  transaction: AppTransaction,
  activeAddress: string,
  contactNameByAddress: Record<string, string>,
  merchantNameByAddress: Record<string, string>,
  faucetAddress?: string,
): TransactionDetailPayload {
  const reward = isRewardTransaction(transaction, faucetAddress);
  const received = transaction.direction !== "send";

  return {
    transaction,
    received,
    fromLabel: resolveAddressLabel(transaction.from, activeAddress, contactNameByAddress, merchantNameByAddress, faucetAddress),
    toLabel: resolveAddressLabel(transaction.to, activeAddress, contactNameByAddress, merchantNameByAddress, faucetAddress),
    typeLabel: reward ? "Reward" : "Currency Transfer",
    statusLabel: "Completed",
  };
}
