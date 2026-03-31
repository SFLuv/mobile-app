export interface AppUser {
  id: string;
  name: string;
  contactEmail?: string;
  contactPhone?: string;
  isAdmin: boolean;
  isMerchant: boolean;
  isOrganizer: boolean;
  isImprover: boolean;
  isProposer: boolean;
  isVoter: boolean;
  isIssuer: boolean;
  isSupervisor: boolean;
  isAffiliate: boolean;
  paypalEthAddress: string;
  lastRedemption: number;
}

export interface AppWallet {
  id?: number;
  owner: string;
  name: string;
  isEoa: boolean;
  isHidden: boolean;
  isRedeemer: boolean;
  isMinter: boolean;
  eoaAddress: string;
  smartAddress?: string;
  smartIndex?: number;
}

export interface AppContact {
  id: number;
  owner: string;
  name: string;
  address: string;
  isFavorite: boolean;
}

export interface AppLocation {
  id: number;
  googleId: string;
  name: string;
  payToAddress?: string;
  description: string;
  type: string;
  street: string;
  city: string;
  state: string;
  zip: string;
  lat: number;
  lng: number;
  phone: string;
  email: string;
  website: string;
  imageUrl: string;
  rating: number;
  mapsPage: string;
  openingHours: string[];
}

export interface AppOwnedLocation extends AppLocation {
  ownerId: string;
  approval?: boolean | null;
  adminPhone: string;
  adminEmail: string;
  contactFirstname: string;
  contactLastname: string;
  contactPhone: string;
  posSystem: string;
  soleProprietorship: string;
  tippingPolicy: string;
  tippingDivision: string;
  tableCoverage: string;
  serviceStations: number;
  tabletModel: string;
  messagingService: string;
  reference: string;
}

export interface AppTransaction {
  id: string;
  hash: string;
  amount: string;
  amountFormatted: string;
  timestamp: number;
  from: string;
  to: string;
  memo?: string;
  direction: "send" | "receive";
}

export interface VerifiedEmail {
  id: string;
  userId: string;
  email: string;
  status: "verified" | "pending" | "expired";
  verifiedAt?: string | null;
  verificationSentAt?: string | null;
  verificationTokenExpiresAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PonderSubscription {
  id: number;
  address: string;
  type: string;
  token?: string;
  email?: string;
}

export interface MerchantPlaceCandidate {
  googleId: string;
  name: string;
  addressLine: string;
  rating: number;
  lat: number;
  lng: number;
  types: string[];
}

export interface MerchantPlaceDetails extends AppLocation {}

export interface MerchantApplicationDraft {
  place: MerchantPlaceDetails | null;
  description: string;
  businessPhone: string;
  businessEmail: string;
  primaryContactEmail: string;
  primaryContactFirstName: string;
  primaryContactLastName: string;
  primaryContactPhone: string;
  posSystem: string;
  soleProprietorship: string;
  tippingPolicy: string;
  tippingDivision: string;
  tableCoverage: string;
  serviceStations: string;
  tabletModel: string;
  messagingService: string;
  reference: string;
}
