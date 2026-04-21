import { ethers } from "ethers";
import { mobileConfig } from "../config";
import {
  AppAccountDeletionPreview,
  AppAccountDeletionStatusResponse,
  AppContact,
  AppLocation,
  AppOwnedLocation,
  AppTransaction,
  AppUser,
  AppWallet,
  AppWalletOwnerLookup,
  MerchantApplicationDraft,
  PonderSubscription,
  VerifiedEmail,
} from "../types/app";

export class AppBackendAuthError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AppBackendAuthError";
    this.status = status;
  }
}

export class AppBackendRequestError extends Error {
  readonly status?: number;

  constructor(message: string, status?: number) {
    super(message);
    this.name = "AppBackendRequestError";
    this.status = status;
  }
}

type GetUserResponse = {
  user: {
    id: string;
    is_admin: boolean;
    is_merchant: boolean;
    is_organizer: boolean;
    is_improver: boolean;
    is_proposer: boolean;
    is_voter: boolean;
    is_issuer: boolean;
    is_supervisor: boolean;
    is_affiliate: boolean;
    contact_email?: string;
    contact_phone?: string;
    contact_name?: string;
    primary_wallet_address?: string;
    paypal_eth: string;
    last_redemption: number;
  };
  wallets: Array<{
    id?: number;
    owner: string;
    name: string;
    is_eoa: boolean;
    is_hidden: boolean;
    is_redeemer: boolean;
    is_minter: boolean;
    eoa_address: string;
    smart_address?: string | null;
    smart_index?: number | null;
  }>;
  contacts: Array<{
    id: number;
    owner: string;
    name: string;
    address: string;
    is_favorite: boolean;
  }>;
  locations: Array<Record<string, unknown>>;
};

type PublicLocationsResponse = {
  locations: Array<Record<string, unknown>>;
};

type TransactionsResponse = {
  transactions: Array<{
    id: string;
    hash: string;
    amount: string;
    timestamp: number;
    from: string;
    to: string;
    memo?: string;
  }>;
  total: number;
};

type VerifiedEmailResponse = Array<{
  id: string;
  user_id: string;
  email: string;
  status: "verified" | "pending" | "expired";
  verified_at?: string | null;
  verification_sent_at?: string | null;
  verification_token_expires_at?: string | null;
  created_at: string;
  updated_at: string;
}>;

type PonderResponse = Array<{
  id: number;
  address: string;
  type: string;
  data?: string;
}>;

type WalletsResponse = Array<{
  id?: number;
  owner: string;
  name: string;
  is_eoa: boolean;
  is_hidden: boolean;
  is_redeemer: boolean;
  is_minter: boolean;
  eoa_address: string;
  smart_address?: string | null;
  smart_index?: number | null;
}>;

type WalletLookupResponse = {
  found?: boolean;
  user_id?: string;
  is_merchant?: boolean;
  merchant_name?: string;
  wallet_name?: string;
  address?: string;
  matched_primary_wallet?: boolean;
  matched_payment_wallet?: boolean;
  pay_to_address?: string;
  tip_to_address?: string;
};

type AccountDeletionPreviewResponse = {
  user_id: string;
  status: "active" | "scheduled_for_deletion" | "ready_for_manual_purge";
  delete_date?: string | null;
  requested_at?: string | null;
  can_cancel: boolean;
  primary_wallet_address: string;
  wallet_addresses: string[];
  counts: {
    wallets: number;
    contacts: number;
    locations: number;
    location_hours: number;
    location_wallets: number;
    ponder_subscriptions: number;
    verified_emails: number;
    memos: number;
  };
  purge_enabled: boolean;
};

type AccountDeletionStatusResponse = {
  user_id: string;
  status: "active" | "scheduled_for_deletion" | "ready_for_manual_purge";
  delete_date?: string | null;
  requested_at?: string | null;
  canceled_at?: string | null;
  completed_at?: string | null;
  can_cancel: boolean;
  purge_enabled: boolean;
  purge_enabled_by?: string;
};

function endpoint(path: string): string {
  return `${mobileConfig.appBackendURL.replace(/\/+$/, "")}${path}`;
}

async function readResponseDetail(response: Response): Promise<string> {
  try {
    const body = await response.text();
    return body.trim();
  } catch {
    return "";
  }
}

async function throwRequestError(response: Response, fallbackMessage: string): Promise<never> {
  const detail = await readResponseDetail(response);
  const message = detail ? `${fallbackMessage} (${response.status}): ${detail}` : `${fallbackMessage} (${response.status}).`;
  throw new AppBackendRequestError(message, response.status);
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapUser(input: GetUserResponse["user"]): AppUser {
  const rawPrimaryWalletAddress = asString(input.primary_wallet_address).trim();
  return {
    id: input.id,
    name: input.contact_name || "SFLUV User",
    primaryWalletAddress: ethers.utils.isAddress(rawPrimaryWalletAddress)
      ? ethers.utils.getAddress(rawPrimaryWalletAddress)
      : undefined,
    contactEmail: input.contact_email,
    contactPhone: input.contact_phone,
    isAdmin: input.is_admin,
    isMerchant: input.is_merchant,
    isOrganizer: input.is_organizer,
    isImprover: input.is_improver,
    isProposer: input.is_proposer,
    isVoter: input.is_voter,
    isIssuer: input.is_issuer,
    isSupervisor: input.is_supervisor,
    isAffiliate: input.is_affiliate,
    paypalEthAddress: input.paypal_eth,
    lastRedemption: input.last_redemption,
  };
}

function mapWallet(input: WalletsResponse[number]): AppWallet {
  return {
    id: typeof input.id === "number" ? input.id : undefined,
    owner: input.owner,
    name: input.name,
    isEoa: input.is_eoa,
    isHidden: input.is_hidden,
    isRedeemer: input.is_redeemer,
    isMinter: input.is_minter,
    eoaAddress: ethers.utils.getAddress(input.eoa_address),
    smartAddress: input.smart_address ? ethers.utils.getAddress(input.smart_address) : undefined,
    smartIndex: typeof input.smart_index === "number" ? input.smart_index : undefined,
  };
}

function mapContact(input: GetUserResponse["contacts"][number]): AppContact {
  return {
    id: input.id,
    owner: input.owner,
    name: input.name,
    address: ethers.utils.getAddress(input.address),
    isFavorite: input.is_favorite,
  };
}

function mapLocation(input: Record<string, unknown>): AppLocation {
  const rawPayToAddress = asString(input.pay_to_address).trim();
  const rawTipToAddress = asString(input.tip_to_address).trim();
  return {
    id: asNumber(input.id),
    googleId: asString(input.google_id),
    name: asString(input.name),
    payToAddress: ethers.utils.isAddress(rawPayToAddress) ? ethers.utils.getAddress(rawPayToAddress) : undefined,
    tipToAddress: ethers.utils.isAddress(rawTipToAddress) ? ethers.utils.getAddress(rawTipToAddress) : undefined,
    description: asString(input.description),
    type: asString(input.type),
    street: asString(input.street),
    city: asString(input.city),
    state: asString(input.state),
    zip: asString(input.zip),
    lat: asNumber(input.lat),
    lng: asNumber(input.lng),
    phone: asString(input.phone),
    email: asString(input.email),
    website: asString(input.website),
    imageUrl: asString(input.image_url),
    rating: asNumber(input.rating),
    mapsPage: asString(input.maps_page),
    openingHours: Array.isArray(input.opening_hours) ? input.opening_hours.map((value) => asString(value)) : [],
  };
}

function mapOwnedLocation(input: Record<string, unknown>): AppOwnedLocation {
  return {
    ...mapLocation(input),
    ownerId: asString(input.owner_id),
    approval: typeof input.approval === "boolean" ? input.approval : null,
    adminPhone: asString(input.admin_phone),
    adminEmail: asString(input.admin_email),
    contactFirstname: asString(input.contact_firstname),
    contactLastname: asString(input.contact_lastname),
    contactPhone: asString(input.contact_phone),
    posSystem: asString(input.pos_system),
    soleProprietorship: asString(input.sole_proprietorship),
    tippingPolicy: asString(input.tipping_policy),
    tippingDivision: asString(input.tipping_division),
    tableCoverage: asString(input.table_coverage),
    serviceStations: asNumber(input.service_stations),
    tabletModel: asString(input.tablet_model),
    messagingService: asString(input.messaging_service),
    reference: asString(input.reference),
  };
}

function mapAccountDeletionPreview(input: AccountDeletionPreviewResponse): AppAccountDeletionPreview {
  return {
    userId: input.user_id,
    status: input.status,
    deleteDate: input.delete_date || undefined,
    requestedAt: input.requested_at || undefined,
    canCancel: input.can_cancel,
    primaryWalletAddress: input.primary_wallet_address,
    walletAddresses: Array.isArray(input.wallet_addresses) ? input.wallet_addresses : [],
    counts: {
      wallets: asNumber(input.counts?.wallets),
      contacts: asNumber(input.counts?.contacts),
      locations: asNumber(input.counts?.locations),
      locationHours: asNumber(input.counts?.location_hours),
      locationWallets: asNumber(input.counts?.location_wallets),
      ponderSubscriptions: asNumber(input.counts?.ponder_subscriptions),
      verifiedEmails: asNumber(input.counts?.verified_emails),
      memos: asNumber(input.counts?.memos),
    },
    purgeEnabled: input.purge_enabled === true,
  };
}

function mapAccountDeletionStatus(input: AccountDeletionStatusResponse): AppAccountDeletionStatusResponse {
  return {
    userId: input.user_id,
    status: input.status,
    deleteDate: input.delete_date || undefined,
    requestedAt: input.requested_at || undefined,
    canceledAt: input.canceled_at || undefined,
    completedAt: input.completed_at || undefined,
    canCancel: input.can_cancel,
    purgeEnabled: input.purge_enabled === true,
    purgeEnabledBy: typeof input.purge_enabled_by === "string" ? input.purge_enabled_by : undefined,
  };
}

function mapWalletOwnerLookup(input: WalletLookupResponse, fallbackAddress: string): AppWalletOwnerLookup | null {
  if (!input.found) {
    return null;
  }

  const normalizedMatchedAddress = asString(input.address).trim();
  const rawPayToAddress = asString(input.pay_to_address).trim();
  const rawTipToAddress = asString(input.tip_to_address).trim();

  return {
    found: true,
    userId: asString(input.user_id) || undefined,
    isMerchant: Boolean(input.is_merchant),
    merchantName: asString(input.merchant_name) || undefined,
    walletName: asString(input.wallet_name) || undefined,
    address: ethers.utils.isAddress(normalizedMatchedAddress)
      ? ethers.utils.getAddress(normalizedMatchedAddress)
      : fallbackAddress,
    matchedPrimaryWallet: input.matched_primary_wallet === true,
    matchedPaymentWallet: input.matched_payment_wallet === true,
    payToAddress: ethers.utils.isAddress(rawPayToAddress) ? ethers.utils.getAddress(rawPayToAddress) : undefined,
    tipToAddress: ethers.utils.isAddress(rawTipToAddress) ? ethers.utils.getAddress(rawTipToAddress) : undefined,
  };
}

function formatTokenAmount(raw: string): string {
  try {
    const formatted = ethers.utils.formatUnits(raw, mobileConfig.tokenDecimals);
    const [whole, fraction = ""] = formatted.split(".");
    const trimmed = fraction.replace(/0+$/, "");
    if (!trimmed) {
      return whole;
    }
    return `${whole}.${trimmed.slice(0, 4)}`;
  } catch {
    return "0";
  }
}

export class AppBackendClient {
  constructor(private readonly getAccessToken: () => Promise<string | null>) {}

  private async authFetch(path: string, options: RequestInit = {}): Promise<Response> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      throw new AppBackendAuthError("Privy could not provide a backend access token. Please sign out and sign in again.");
    }
    const extraHeaders = (options.headers || {}) as Record<string, string>;
    const headers: Record<string, string> = {
      ...extraHeaders,
      "Access-Token": accessToken,
    };
    let response: Response;
    try {
      response = await fetch(endpoint(path), { ...options, headers });
    } catch (error) {
      throw new AppBackendRequestError(
        `Unable to reach the shared app backend at ${mobileConfig.appBackendURL}. ${(error as Error)?.message ?? ""}`.trim(),
      );
    }

    if (response.status === 401 || response.status === 403) {
      const detail = await readResponseDetail(response);
      const message = detail
        ? `Shared app backend rejected this Privy session (${response.status}): ${detail}`
        : "Shared app backend rejected this Privy session. Please sign out and sign in again.";
      throw new AppBackendAuthError(message, response.status);
    }

    return response;
  }

  async ensureUser(): Promise<{
    user: AppUser;
    wallets: AppWallet[];
    contacts: AppContact[];
    locations: AppOwnedLocation[];
  }> {
    let response = await this.authFetch("/users");
    if (response.status === 404) {
      const created = await this.authFetch("/users", { method: "POST" });
      if (!created.ok) {
        await throwRequestError(created, "Unable to create user profile in the shared app backend");
      }
      response = await this.authFetch("/users");
    }

    if (!response.ok) {
      await throwRequestError(response, "Unable to load user profile from the shared app backend");
    }

    const body = (await response.json()) as GetUserResponse;
    return {
      user: mapUser(body.user),
      wallets: Array.isArray(body.wallets) ? body.wallets.map(mapWallet) : [],
      contacts: Array.isArray(body.contacts) ? body.contacts.map(mapContact) : [],
      locations: Array.isArray(body.locations) ? body.locations.map(mapOwnedLocation) : [],
    };
  }

  async getDeleteAccountStatus(): Promise<AppAccountDeletionStatusResponse | null> {
    const response = await this.authFetch("/users/delete-account/status");
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      await throwRequestError(response, "Unable to load account deletion status from the shared app backend");
    }
    const body = (await response.json()) as AccountDeletionStatusResponse;
    return mapAccountDeletionStatus(body);
  }

  async getDeleteAccountPreview(): Promise<AppAccountDeletionPreview> {
    const response = await this.authFetch("/users/delete-account/preview");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load account deletion preview from the shared app backend");
    }
    const body = (await response.json()) as AccountDeletionPreviewResponse;
    return mapAccountDeletionPreview(body);
  }

  async deleteAccount(): Promise<AppAccountDeletionStatusResponse> {
    const response = await this.authFetch("/users/delete-account", {
      method: "POST",
    });
    if (response.status !== 202) {
      await throwRequestError(response, "Unable to schedule account deletion in the shared app backend");
    }
    const body = (await response.json()) as AccountDeletionStatusResponse;
    return mapAccountDeletionStatus(body);
  }

  async cancelDeleteAccount(): Promise<AppAccountDeletionStatusResponse> {
    const response = await this.authFetch("/users/delete-account/cancel", {
      method: "POST",
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to reactivate this account in the shared app backend");
    }
    const body = (await response.json()) as AccountDeletionStatusResponse;
    return mapAccountDeletionStatus(body);
  }

  async getWallets(): Promise<AppWallet[]> {
    const response = await this.authFetch("/wallets");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load wallets from the shared app backend");
    }
    const body = (await response.json()) as WalletsResponse;
    return Array.isArray(body) ? body.map(mapWallet) : [];
  }

  async addWallet(wallet: AppWallet): Promise<void> {
    const response = await this.authFetch("/wallets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: wallet.id ?? 0,
        owner: wallet.owner,
        name: wallet.name,
        is_eoa: wallet.isEoa,
        is_hidden: wallet.isHidden,
        is_redeemer: wallet.isRedeemer,
        is_minter: wallet.isMinter,
        eoa_address: wallet.eoaAddress,
        smart_address: wallet.smartAddress ?? null,
        smart_index: typeof wallet.smartIndex === "number" ? wallet.smartIndex : null,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to add wallet to the shared app backend");
    }
  }

  async updateWallet(wallet: AppWallet): Promise<void> {
    if (typeof wallet.id !== "number") {
      throw new Error("Wallet ID is required to update wallet settings.");
    }

    const response = await this.authFetch("/wallets", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: wallet.id,
        owner: wallet.owner,
        name: wallet.name,
        is_hidden: wallet.isHidden,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update wallet settings in the shared app backend");
    }
  }

  async ensureLegacyWallets(ownerAddress: string, candidates: Array<{ smartIndex: number; accountAddress: string }>): Promise<void> {
    const normalizedOwner = ethers.utils.getAddress(ownerAddress);
    const existing = await this.getWallets();
    const existingKeys = new Set(
      existing
        .filter((wallet) => !wallet.isEoa && wallet.smartAddress && typeof wallet.smartIndex === "number")
        .map((wallet) => `${wallet.smartIndex}:${wallet.smartAddress?.toLowerCase()}`),
    );

    for (const candidate of candidates) {
      const normalizedSmart = ethers.utils.getAddress(candidate.accountAddress);
      const key = `${candidate.smartIndex}:${normalizedSmart.toLowerCase()}`;
      if (existingKeys.has(key)) {
        continue;
      }

      await this.addWallet({
        id: 0,
        owner: "",
        name: `Wallet ${candidate.smartIndex + 1}`,
        isEoa: false,
        isHidden: false,
        isRedeemer: false,
        isMinter: false,
        eoaAddress: normalizedOwner,
        smartAddress: normalizedSmart,
        smartIndex: candidate.smartIndex,
      });
      existingKeys.add(key);
    }
  }

  async updatePrimaryWallet(address: string): Promise<string> {
    const normalizedAddress = ethers.utils.getAddress(address);
    const response = await this.authFetch("/users/primary-wallet", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        primary_wallet_address: normalizedAddress,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update primary wallet in the shared app backend");
    }
    const body = (await response.json()) as GetUserResponse["user"];
    const rawPrimaryWalletAddress = asString(body.primary_wallet_address).trim();
    if (!ethers.utils.isAddress(rawPrimaryWalletAddress)) {
      throw new Error("Shared app backend returned an invalid primary wallet.");
    }
    return ethers.utils.getAddress(rawPrimaryWalletAddress);
  }

  async getContacts(): Promise<AppContact[]> {
    const response = await this.authFetch("/contacts");
    if (!response.ok) {
      await throwRequestError(response, "Unable to load contacts from the shared app backend");
    }
    const body = (await response.json()) as GetUserResponse["contacts"];
    return Array.isArray(body) ? body.map(mapContact) : [];
  }

  async addContact(name: string, address: string): Promise<AppContact> {
    const response = await this.authFetch("/contacts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        owner: "",
        name,
        address,
        is_favorite: false,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to add contact in the shared app backend");
    }
    const body = (await response.json()) as GetUserResponse["contacts"][number];
    return mapContact(body);
  }

  async toggleFavorite(contact: AppContact): Promise<void> {
    const response = await this.authFetch("/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: contact.id,
        owner: contact.owner,
        name: contact.name,
        address: contact.address,
        is_favorite: !contact.isFavorite,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update contact in the shared app backend");
    }
  }

  async updateContact(contact: AppContact): Promise<void> {
    const response = await this.authFetch("/contacts", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: contact.id,
        owner: contact.owner,
        name: contact.name,
        address: contact.address,
        is_favorite: contact.isFavorite,
      }),
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to update contact in the shared app backend");
    }
  }

  async deleteContact(contactID: number): Promise<void> {
    const response = await this.authFetch(`/contacts?id=${contactID}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      await throwRequestError(response, "Unable to delete contact from the shared app backend");
    }
  }

  async getPublicLocations(): Promise<AppLocation[]> {
    const response = await fetch(endpoint("/locations"));
    if (!response.ok) {
      throw new Error("Unable to load merchant map.");
    }
    const body = (await response.json()) as PublicLocationsResponse;
    return Array.isArray(body.locations) ? body.locations.map(mapLocation) : [];
  }

  async lookupWalletOwner(address: string): Promise<AppWalletOwnerLookup | null> {
    const normalizedAddress = ethers.utils.getAddress(address);
    const response = await this.authFetch(`/wallets/lookup/${encodeURIComponent(normalizedAddress)}`);
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as WalletLookupResponse;
    return mapWalletOwnerLookup(body, normalizedAddress);
  }

  async redeemCode(code: string, address: string): Promise<void> {
    const response = await fetch(endpoint("/redeem"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        address,
      }),
    });

    if (response.ok) {
      return;
    }

    const rawBody = (await response.text()).trim();
    try {
      const parsed = JSON.parse(rawBody) as { reason?: string; error?: string };
      if (parsed.reason === "w9_required" || parsed.error === "w9_required") {
        throw new Error("A W9 form is required before this reward can be redeemed.");
      }
      if (parsed.reason === "w9_pending" || parsed.error === "w9_pending") {
        throw new Error("Your W9 form is still being processed. Try this QR code again once it is approved.");
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "A W9 form is required before this reward can be redeemed." ||
          error.message === "Your W9 form is still being processed. Try this QR code again once it is approved.")
      ) {
        throw error;
      }
    }

    switch (rawBody) {
      case "code not started":
        throw new Error("This perk is not active yet.");
      case "code expired":
        throw new Error("This perk has expired.");
      case "code redeemed":
        throw new Error("This QR code has already been redeemed.");
      case "user redeemed":
        throw new Error("You have already redeemed this perk.");
      default:
        throw new Error("Unable to redeem this QR code right now.");
    }
  }

  async getVerifiedEmails(): Promise<VerifiedEmail[]> {
    const response = await this.authFetch("/users/verified-emails");
    if (!response.ok) {
      throw new Error("Unable to load verified emails.");
    }
    const body = (await response.json()) as VerifiedEmailResponse;
    return body.map((entry) => ({
      id: entry.id,
      userId: entry.user_id,
      email: entry.email,
      status: entry.status,
      verifiedAt: entry.verified_at,
      verificationSentAt: entry.verification_sent_at,
      verificationTokenExpiresAt: entry.verification_token_expires_at,
      createdAt: entry.created_at,
      updatedAt: entry.updated_at,
    }));
  }

  async getNotificationSubscriptions(): Promise<PonderSubscription[]> {
    const response = await this.authFetch("/ponder");
    if (!response.ok) {
      throw new Error("Unable to load wallet notifications.");
    }
    const body = (await response.json()) as PonderResponse;
    return body.map((entry) => ({
      id: entry.id,
      address: entry.address,
      type: entry.type,
      email: entry.type === "merchant" ? entry.data : undefined,
      token: entry.type === "push" ? entry.data : undefined,
    }));
  }

  async enableNotification(email: string, address: string): Promise<void> {
    const response = await this.authFetch("/ponder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, address }),
    });
    if (!response.ok) {
      throw new Error("Unable to enable notifications.");
    }
  }

  async disableNotification(id: number): Promise<void> {
    const response = await this.authFetch(`/ponder?id=${id}`, { method: "DELETE" });
    if (!response.ok) {
      throw new Error("Unable to disable notifications.");
    }
  }

  async syncPushNotifications(token: string, addresses: string[]): Promise<void> {
    const response = await this.authFetch("/ponder/push", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, addresses }),
    });
    if (!response.ok) {
      throw new Error("Unable to sync push notifications.");
    }
  }

  async getTransactions(address: string, page = 0, count = 30): Promise<AppTransaction[]> {
    const response = await this.authFetch(
      `/transactions?address=${encodeURIComponent(address)}&page=${page}&count=${count}&desc=true`,
    );
    if (!response.ok) {
      throw new Error("Unable to load transaction history.");
    }
    const body = (await response.json()) as TransactionsResponse;
    return (body.transactions || []).map((tx) => ({
      id: tx.id,
      hash: tx.hash,
      amount: tx.amount,
      amountFormatted: formatTokenAmount(tx.amount),
      timestamp: tx.timestamp,
      from: tx.from,
      to: tx.to,
      memo: tx.memo,
      direction: tx.from.toLowerCase() === address.toLowerCase() ? "send" : "receive",
    }));
  }

  async lookupMerchantWalletLabel(address: string): Promise<string | null> {
    const normalizedAddress = ethers.utils.getAddress(address);
    const response = await this.authFetch(`/wallets/lookup/${encodeURIComponent(normalizedAddress)}`);
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as WalletLookupResponse;
    if (!body.found || !body.is_merchant) {
      return null;
    }
    const merchantName = (body.merchant_name || body.wallet_name || "").trim();
    return merchantName || null;
  }

  async saveTransactionMemo(txHash: string, memo: string): Promise<void> {
    const trimmed = memo.trim();
    if (!trimmed) {
      return;
    }
    const response = await this.authFetch("/transactions/memo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tx_hash: txHash, memo: trimmed }),
    });
    if (!response.ok) {
      throw new Error("Unable to save transaction memo.");
    }
  }

  async submitMerchantApplication(draft: MerchantApplicationDraft): Promise<void> {
    if (!draft.place) {
      throw new Error("Select your business location first.");
    }

    const response = await this.authFetch("/locations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: 0,
        google_id: draft.place.googleId,
        owner_id: "",
        name: draft.place.name,
        description: draft.description.trim(),
        type: draft.place.type,
        street: draft.place.street,
        city: draft.place.city,
        state: draft.place.state,
        zip: draft.place.zip,
        lat: draft.place.lat,
        lng: draft.place.lng,
        phone: draft.businessPhone.trim(),
        email: draft.businessEmail.trim(),
        admin_phone: draft.primaryContactPhone.trim(),
        admin_email: draft.primaryContactEmail.trim(),
        website: draft.place.website,
        image_url: draft.place.imageUrl,
        rating: draft.place.rating,
        maps_page: draft.place.mapsPage,
        opening_hours: draft.place.openingHours,
        contact_firstname: draft.primaryContactFirstName.trim(),
        contact_lastname: draft.primaryContactLastName.trim(),
        contact_phone: draft.primaryContactPhone.trim(),
        pos_system: draft.posSystem.trim(),
        sole_proprietorship: draft.soleProprietorship.trim(),
        tipping_policy: draft.tippingPolicy.trim(),
        tipping_division: draft.tippingDivision.trim(),
        table_coverage: draft.tableCoverage.trim(),
        service_stations: Number(draft.serviceStations || "0"),
        tablet_model: draft.tabletModel.trim(),
        messaging_service: draft.messagingService.trim(),
        reference: draft.reference.trim(),
      }),
    });

    if (!response.ok) {
      throw new Error("Unable to submit merchant application.");
    }
  }
}
