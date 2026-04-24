import { AppContact, AppLocation, AppTransaction } from "../types/app";

export const FAUCET_ADDRESS = "0x21df0dfce7420c2dc4c92ec335e9f9ad447e864a";

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

export function isRewardTransaction(transaction: AppTransaction): boolean {
  return transaction.direction !== "send" && transaction.from.toLowerCase() === FAUCET_ADDRESS;
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
): string {
  const normalizedAddress = address.toLowerCase();
  if (activeAddress && normalizedAddress === activeAddress.toLowerCase()) {
    return "You";
  }
  if (normalizedAddress === FAUCET_ADDRESS) {
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
): TransactionDetailPayload {
  const reward = isRewardTransaction(transaction);
  const received = transaction.direction !== "send";

  return {
    transaction,
    received,
    fromLabel: resolveAddressLabel(transaction.from, activeAddress, contactNameByAddress, merchantNameByAddress),
    toLabel: resolveAddressLabel(transaction.to, activeAddress, contactNameByAddress, merchantNameByAddress),
    typeLabel: reward ? "Reward" : "Currency Transfer",
    statusLabel: "Completed",
  };
}
