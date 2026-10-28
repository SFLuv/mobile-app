import { AppContact, AppLocation, AppTransaction } from "../types/app";

export type TransactionDetailPayload = {
  transaction: AppTransaction;
  fromLabel: string;
  toLabel: string;
  received: boolean;
  typeLabel: string;
  statusLabel: string;
};

/**
 * A transaction the chat knows about, which the viewer may not.
 *
 * Shared out of somebody else's history, or made in the chat seconds ago and
 * not indexed yet. Either way the thread has the chain facts and the viewer's
 * own history does not, which is the whole reason this type exists.
 */
export type ChatTransactionRef = {
  txHash: string;
  amountSfluvBase?: string | null;
  from?: string | null;
  to?: string | null;
  /** Unix seconds. */
  at?: number | null;
  /**
   * Whether the viewer sent it, for the case where neither address is known —
   * a payment bubble carries no addresses, only who posted it.
   */
  mine?: boolean;
};

/**
 * Base units to a readable amount, without going through a float.
 *
 * Integer string arithmetic because these are token base units: 6 decimals for
 * SFLUV, and Number() on a large base-unit string loses the low digits.
 */
function formatBaseUnits(base: string, decimals: number): string {
  const negative = base.trim().startsWith("-");
  const digits = base.replace(/\D/g, "") || "0";
  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals) || "0";
  const fraction = decimals > 0 ? padded.slice(padded.length - decimals).replace(/0+$/, "") : "";
  const body = fraction ? `${whole}.${fraction.slice(0, 4)}` : whole;
  return negative ? `-${body}` : body;
}

/**
 * The transaction sheet for a transfer shared in a chat.
 *
 * ── Why this exists next to buildTransactionDetailPayload ───────────────────
 *
 * The shell used to resolve a shared transaction by looking the hash up in
 * walletTransactions and activityTransactions and refusing — "that transaction
 * isn't in your history" — when it was not there. Those lists only ever hold
 * the signed-in person's own transfers, so the refusal fired for exactly the
 * case the feature is for: somebody else's record, shared into the thread. It
 * also fired on your own payment for the minute or so before the indexer caught
 * up with it.
 *
 * The attachment already carries what the sheet needs — amount, both parties,
 * when — because the server resolves it from the index when the message is
 * read. So a missing history row is not a dead end: this builds the same sheet
 * from the thread's own copy. The history row is still preferred when there is
 * one, because it additionally has the memo and the server's transfer type.
 */
export function buildChatTransactionPayload(
  ref: ChatTransactionRef,
  activeAddress: string,
  contactNameByAddress: Record<string, string>,
  merchantNameByAddress: Record<string, string>,
  tokenDecimals: number,
  faucetAddress?: string,
): TransactionDetailPayload {
  const from = ref.from?.trim() || "";
  const to = ref.to?.trim() || "";
  const active = activeAddress.trim().toLowerCase();

  // Addresses decide direction when they are known. When they are not, the
  // bubble's own "I posted this" is the only evidence available, and it is
  // reliable for a payment made in the chat.
  const received = from && active ? from.toLowerCase() !== active : !ref.mine;

  const amount = ref.amountSfluvBase ?? "";
  const label = (address: string) =>
    address
      ? resolveAddressLabel(address, activeAddress, contactNameByAddress, merchantNameByAddress, faucetAddress)
      : "Unknown";

  return {
    transaction: {
      // Not a history row, so it has no history id. Derived from the hash so it
      // is still stable and distinct.
      id: `chat:${ref.txHash}`,
      hash: ref.txHash,
      amount,
      amountFormatted: amount ? formatBaseUnits(amount, tokenDecimals) : "—",
      timestamp: ref.at ?? 0,
      from,
      to,
      direction: received ? "receive" : "send",
    },
    received,
    fromLabel: label(from),
    toLabel: label(to),
    typeLabel: "Currency Transfer",
    statusLabel: "Completed",
  };
}

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

// A transfer is a reward when the faucet paid it. The backend decides that
// from who the faucet was at the time of the transfer, so rewards keep their
// label when the faucet moves to a new wallet. The comparison against
// faucetAddress is only for transfers the backend has not labelled: an older
// backend, or transfers read straight off chain.
export function isRewardTransaction(transaction: AppTransaction, faucetAddress?: string): boolean {
  if (transaction.direction === "send") {
    return false;
  }
  if (transaction.type !== undefined) {
    return transaction.type === "volunteer_reward";
  }
  const normalizedFaucet = normalizeAddress(faucetAddress);
  return Boolean(normalizedFaucet) && normalizeAddress(transaction.from) === normalizedFaucet;
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
