import { ethers } from "ethers";
import { mobileConfig } from "../config";
import {
  AppContact,
  AppLocation,
  AppOwnedLocation,
  AppTransaction,
  AppUser,
  MerchantApplicationDraft,
  PonderSubscription,
  VerifiedEmail,
} from "../types/app";

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
    paypal_eth: string;
    last_redemption: number;
  };
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
  email: string;
  address: string;
  type: string;
}>;

function endpoint(path: string): string {
  return `${mobileConfig.appBackendURL.replace(/\/+$/, "")}${path}`;
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function mapUser(input: GetUserResponse["user"]): AppUser {
  return {
    id: input.id,
    name: input.contact_name || "SFLUV User",
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
  return {
    id: asNumber(input.id),
    googleId: asString(input.google_id),
    name: asString(input.name),
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
      throw new Error("No Privy access token available.");
    }
    const extraHeaders = (options.headers || {}) as Record<string, string>;
    const headers: Record<string, string> = {
      ...extraHeaders,
      "Access-Token": accessToken,
    };
    return fetch(endpoint(path), { ...options, headers });
  }

  async ensureUser(): Promise<{
    user: AppUser;
    contacts: AppContact[];
    locations: AppOwnedLocation[];
  }> {
    let response = await this.authFetch("/users");
    if (response.status === 404) {
      const created = await this.authFetch("/users", { method: "POST" });
      if (!created.ok) {
        throw new Error("Unable to create user profile in app backend.");
      }
      response = await this.authFetch("/users");
    }

    if (!response.ok) {
      throw new Error("Unable to load user profile.");
    }

    const body = (await response.json()) as GetUserResponse;
    return {
      user: mapUser(body.user),
      contacts: Array.isArray(body.contacts) ? body.contacts.map(mapContact) : [],
      locations: Array.isArray(body.locations) ? body.locations.map(mapOwnedLocation) : [],
    };
  }

  async getContacts(): Promise<AppContact[]> {
    const response = await this.authFetch("/contacts");
    if (!response.ok) {
      throw new Error("Unable to load contacts.");
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
      throw new Error("Unable to add contact.");
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
      throw new Error("Unable to update contact.");
    }
  }

  async deleteContact(contactID: number): Promise<void> {
    const response = await this.authFetch(`/contacts?id=${contactID}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      throw new Error("Unable to delete contact.");
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
      email: entry.email,
      address: entry.address,
      type: entry.type,
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
